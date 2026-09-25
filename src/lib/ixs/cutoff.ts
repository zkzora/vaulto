/**
 * IXS settlement cutoff calculator.
 *
 * IXS stated (24 Sep 2026, reply in the public OpenServ Telegram): requests can be sent at any time and are processed
 * at the next daily cutoff, 17:00 Singapore time (UTC+8) = 09:00 UTC, on Singapore business days (Monday–Friday).
 * Vaulto assumptions (not stated by IXS): settlement about one business day after the cutoff, and Singapore public
 * holidays from the public MOM calendar.
 */

export const CUTOFF_HOUR_UTC = 9; // 17:00 SGT
export const CUTOFF_SOURCE = "IXS stated (24 Sep 2026): daily cutoff 17:00 SGT (09:00 UTC) on Singapore business days Mon–Fri; requests can be sent anytime and are processed at the next cutoff. Settlement ≈ 1 business day later is a Vaulto estimate";

/** Singapore public holidays (gazetted dates as published; treated as ASSUMED, not confirmed by IXS). */
export const SG_HOLIDAYS: Record<string, string> = {
  "2026-01-01": "New Year's Day",
  "2026-02-17": "Chinese New Year",
  "2026-02-18": "Chinese New Year (day 2)",
  "2026-03-20": "Hari Raya Puasa",
  "2026-04-03": "Good Friday",
  "2026-05-01": "Labour Day",
  "2026-05-27": "Hari Raya Haji",
  "2026-06-01": "Vesak Day (in lieu)",
  "2026-08-10": "National Day (in lieu)",
  "2026-11-09": "Deepavali (in lieu)",
  "2026-12-25": "Christmas Day",
  "2027-01-01": "New Year's Day",
};

export interface CutoffInfo {
  /** Next cutoff instant (ISO, UTC). */
  nextCutoffUtc: string;
  /** Same instant in Singapore time, for display. */
  nextCutoffSgt: string;
  hoursUntilCutoff: number;
  /** Whether a request sent now still makes today's cutoff. */
  todayCutoffStillOpen: boolean;
  /** Estimated settlement instant (ISO, UTC): one Singapore business day after the cutoff. */
  estimatedSettlementUtc: string;
  estimatedSettlementSgt: string;
  /** Non-business days skipped between now and settlement (weekends, assumed holidays). */
  skipped: { date: string; reason: string }[];
  holidayAssumption: string;
  source: string;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

function isBusinessDay(d: Date): { ok: boolean; reason?: string } {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return { ok: false, reason: dow === 0 ? "Sunday" : "Saturday" };
  const h = SG_HOLIDAYS[dayKey(d)];
  if (h) return { ok: false, reason: `${h} (SG public holiday, assumed)` };
  return { ok: true };
}

function atCutoff(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), CUTOFF_HOUR_UTC, 0, 0));
}

const sgt = (d: Date) => new Date(d.getTime() + 8 * 3600_000).toISOString().replace("T", " ").slice(0, 16) + " SGT";

/** Next cutoff for a request sent at `now`, and the estimated settlement one business day later. */
export function nextCutoff(now: Date = new Date()): CutoffInfo {
  const skipped: { date: string; reason: string }[] = [];
  let day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let todayOpen = false;
  // First cutoff at or after now on a business day.
  for (let i = 0; i < 20; i++) {
    const biz = isBusinessDay(day);
    const cut = atCutoff(day);
    if (biz.ok && cut.getTime() >= now.getTime()) {
      todayOpen = i === 0;
      break;
    }
    if (!biz.ok) skipped.push({ date: dayKey(day), reason: biz.reason! });
    day = new Date(day.getTime() + 86_400_000);
  }
  const cutoff = atCutoff(day);
  // Settlement: the next business day after the cutoff day.
  let settle = new Date(day.getTime() + 86_400_000);
  for (let i = 0; i < 20; i++) {
    const biz = isBusinessDay(settle);
    if (biz.ok) break;
    skipped.push({ date: dayKey(settle), reason: biz.reason! });
    settle = new Date(settle.getTime() + 86_400_000);
  }
  const settlement = atCutoff(settle);
  return {
    nextCutoffUtc: cutoff.toISOString(),
    nextCutoffSgt: sgt(cutoff),
    hoursUntilCutoff: Math.round(((cutoff.getTime() - now.getTime()) / 3600_000) * 10) / 10,
    todayCutoffStillOpen: todayOpen,
    estimatedSettlementUtc: settlement.toISOString(),
    estimatedSettlementSgt: sgt(settlement),
    skipped,
    holidayAssumption: "Singapore public holidays from the public calendar and the settlement estimate are Vaulto assumptions, not IXS statements",
    source: CUTOFF_SOURCE,
  };
}
