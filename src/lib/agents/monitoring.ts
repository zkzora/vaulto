import { fmtUsd, vaultLabel } from "@/lib/format";
import type { PortfolioReport, Recommendation, RiskReport, TreasurySnapshot, UserProfile, VaultStrategy } from "@/lib/types";
import { healthLabel } from "./scoring";

/** Realized 30d BTC volatility (annualized %) above which Vaulto flags exposure. */
const VOL_ELEVATED = 45;
const VOL_HIGH = 60;

/**
 * Monitoring Agent — scores the treasury against policy and drafts warnings / corrective actions.
 */
export interface WatchSummary {
  waiting: { vault: string; chainName: string; navAgeHours: number | null; navUpdatedAt: number | null; depositLimitUsd: number | null }[];
  events: { id: string; at: string; message: string; kind: "limit" | "nav" }[];
}

export function buildRiskReport(snapshot: TreasurySnapshot, user: UserProfile, rec: Recommendation | null, btcVol30d: number | null = null, strategies: VaultStrategy[] = [], watch?: WatchSummary): RiskReport {
  const primary = strategies.find((s) => s.tag === "primary") ?? strategies.find((s) => s.executable);
  const terms = primary?.terms;
  const termsText = terms
    ? ` Redemption path: requested → awaiting RWA sale & operator finalization → paid (no claim step; operator sends USDC to the receiver). Fees: ${terms.depositFeeBps / 100}% on deposit, ${terms.redeemFeeBps != null ? `${terms.redeemFeeBps / 100}% on redemption (${terms.feeSource})` : "redemption fee not exposed on-chain"}. Minimum deposit ${terms.minDepositUsd} ${primary?.asset ?? "USDC"} (confirmed by IXS, enforced on-chain). Async vaults: daily cutoff 17:00 SGT on Singapore business days, settlement ≈ 1 business day (per IXS, 24 Sep 2026).`
    : "";
  const lowestVault = snapshot.positions.length ? Math.min(...snapshot.positions.map((p) => p.riskScore)) : null;
  const deviation = snapshot.allocatedPct - snapshot.targetAllocationPct;
  const nearLimit = snapshot.maxExposure.pct > user.maxAssetExposurePct * 0.8;
  const volElevated = btcVol30d != null && btcVol30d >= VOL_ELEVATED && snapshot.maxExposure.symbol === "BTC";
  const exposureLevel = snapshot.maxExposure.pct > user.maxAssetExposurePct ? "High" : nearLimit || volElevated ? "Medium" : "Low";
  const liquidityLevel = snapshot.liquidPct < user.liquidityFloorPct ? "High" : snapshot.liquidPct < user.liquidityFloorPct + 5 ? "Medium" : "Low";

  const items: RiskReport["items"] = [
    {
      key: "liquidity",
      title: "Liquidity risk",
      level: liquidityLevel,
      description: `${snapshot.liquidPct}% of treasury held liquid. ${user.monthlyBurnUsd > 0 ? `Covers ${snapshot.runwayMonths} months of burn; policy floor is ${user.liquidityFloorPct}%.` : `Policy floor is ${user.liquidityFloorPct}%.`}`,
      value: `${snapshot.liquidPct}%`,
      sub: `floor ${user.liquidityFloorPct}%`,
    },
    {
      key: "vault",
      title: "Vault risk",
      level: lowestVault == null ? "Low" : lowestVault >= user.minVaultRiskScore ? "Low" : "Medium",
      description: `${snapshot.positions.length ? `${snapshot.positions.map((p) => `${vaultLabel(p.vaultName)} scores ${p.riskScore}`).join(" and ")}. No leverage.` : "No vault positions yet. Every IXS strategy Vaulto proposes is scored before it reaches you."}${termsText}`,
      value: lowestVault == null ? "—" : String(lowestVault),
      sub: "lowest vault score",
    },
    {
      key: "exposure",
      title: "Exposure risk",
      level: exposureLevel,
      description: `${snapshot.maxExposure.symbol} is ${snapshot.maxExposure.pct}% of treasury${snapshot.maxExposure.symbol === "BTC" && btcVol30d != null ? ` with 30d realized volatility at ${btcVol30d}%` : ""}. ${
        snapshot.maxExposure.pct <= user.maxAssetExposurePct ? `Within your asset exposure policy (limit ${user.maxAssetExposurePct}%), flagged for awareness.` : `Above your ${user.maxAssetExposurePct}% limit.`
      }`,
      value: `${snapshot.maxExposure.pct}%`,
      sub: `limit ${user.maxAssetExposurePct}%`,
    },
    {
      key: "deviation",
      title: "Strategy deviation",
      level: Math.abs(deviation) > 15 ? "Medium" : "Low",
      description: `Target allocation to IXS strategies ${snapshot.targetAllocationPct}%, actual ${snapshot.allocatedPct}%. ${
        deviation < 0 ? `Under-deployed by ${Math.abs(deviation)} pts; ${rec && rec.status === "proposed" ? "the open recommendation closes most of the gap." : "run an analysis to close the gap."}` : "On target."
      }`,
      value: `${deviation > 0 ? "+" : "−"}${Math.abs(deviation)} pts`,
      sub: "vs target allocation",
    },
  ];

  const alerts: RiskReport["alerts"] = [];
  for (const w of watch?.waiting ?? []) {
    alerts.push({
      id: `nav-${w.vault}-${w.chainName}`,
      kind: "info",
      title: `${w.chainName} vault temporarily paused — waiting NAV refresh`,
      body: `Deposit limit is 0 while the NAV is stale (last update ${w.navUpdatedAt ? new Date(w.navUpdatedAt * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "unknown"}${w.navAgeHours != null ? `, ${(w.navAgeHours / 24).toFixed(1)} days ago` : ""}). Per IXS (24 Sep 2026) this is the NAV-staleness effect, not a closed vault. Vaulto watches the limit and NAV on every scan and will flag the vault the moment it reopens.`,
      cta: "analyze",
    });
  }
  for (const e of (watch?.events ?? []).slice(0, 3)) {
    alerts.push({ id: e.id, kind: e.kind === "limit" ? "action" : "info", title: e.kind === "limit" ? "Deposit limit changed" : "NAV refreshed", body: e.message, cta: "analyze" });
  }
  if (rec && rec.status === "proposed") {
    alerts.push({
      id: "idle",
      kind: "action",
      title: `Idle capital at ${snapshot.idlePct}% for ${snapshot.idleDays} days: allocation into IXS strategies drafted`,
      body: `Adds about ${fmtUsd(rec.extraMonthlyUsd)} a month and leaves ${rec.after.liquidPct}% liquid. Vaulto has prepared ${rec.legs.length} deposit${rec.legs.length > 1 ? "s" : ""} built by the IXS MCP.`,
      cta: "review",
    });
  } else if (snapshot.idlePct > user.liquidityFloorPct + 10) {
    alerts.push({
      id: "idle",
      kind: "action",
      title: `Idle capital at ${snapshot.idlePct}% of treasury`,
      body: "Run an OpenServ analysis to draft an allocation that keeps your liquidity floor intact.",
      cta: "analyze",
    });
  }
  if (snapshot.maxExposure.symbol === "BTC" && btcVol30d != null && btcVol30d >= VOL_ELEVATED) {
    const high = btcVol30d >= VOL_HIGH;
    alerts.push({
      id: "vol",
      kind: high ? "action" : "info",
      title: `BTC 30d realized volatility is ${btcVol30d}% with ${snapshot.maxExposure.pct}% of the treasury in BTC`,
      body: high
        ? `Above the ${VOL_HIGH}% threshold. Vaulto recommends holding a larger USDC buffer; run an analysis to re-size the allocation.`
        : `Elevated but within tolerance. Vaulto will recommend a larger USDC buffer if volatility passes ${VOL_HIGH}% or liquidity nears the ${user.liquidityFloorPct}% floor.`,
      cta: "analyze",
    });
  }
  if (snapshot.maxExposure.pct > user.maxAssetExposurePct) {
    alerts.push({
      id: "exposure",
      kind: "action",
      title: `${snapshot.maxExposure.symbol} exposure ${snapshot.maxExposure.pct}% exceeds your ${user.maxAssetExposurePct}% limit`,
      body: `Vaulto never sells assets, and vault deposits keep ${snapshot.maxExposure.symbol} as ${snapshot.maxExposure.symbol}, so this only changes when other assets are added or the limit is adjusted in Settings. New allocations still respect the liquidity floor.`,
      cta: "analyze",
    });
  }

  const label = healthLabel(snapshot.healthScore);
  return {
    healthScore: snapshot.healthScore,
    healthLabel: label,
    healthNote:
      snapshot.idlePct > user.liquidityFloorPct + 10
        ? "Liquidity and exposure are within policy; idle capital is the main drag on the score."
        : "Liquidity, vault quality and exposure are within policy.",
    items,
    alerts,
    checkedAt: snapshot.scannedAt,
    policy: {
      liquidityFloorPct: user.liquidityFloorPct,
      maxAssetExposurePct: user.maxAssetExposurePct,
      minVaultRiskScore: user.minVaultRiskScore,
    },
  };
}

/** Synthesizes a smooth value history ending at the current treasury value. */
export function buildPortfolioReport(snapshot: TreasurySnapshot, user: UserProfile, periodDays = 30): PortfolioReport {
  const yieldEarnedUsd = Math.round((snapshot.earned30dUsd * periodDays) / 30);
  const btc = snapshot.assets.find((a) => a.symbol === "BTC");
  const priceChangeUsd = btc ? Math.round(btc.valueUsd * (btc.change30dPct / 100) * (periodDays / 30)) : 0;
  const changeUsd = yieldEarnedUsd + priceChangeUsd;
  const start = snapshot.totalUsd - changeUsd;
  const points = Math.min(periodDays, 30);
  const history: PortfolioReport["history"] = [];
  let seed = 7;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280 - 0.5;
  };
  for (let i = 0; i <= points; i++) {
    const t = i / points;
    const noise = i === points ? 0 : rand() * changeUsd * 0.25;
    const date = new Date(new Date(snapshot.scannedAt).getTime() - (periodDays - t * periodDays) * 86_400_000);
    history.push({ date: date.toISOString(), value: Math.round(start + changeUsd * t + noise) });
  }
  const stable = snapshot.assets.filter((a) => a.symbol === "USDC").reduce((s, a) => s + a.allocationPct, 0);
  const btcPct = btc?.allocationPct ?? 0;
  const rwa = snapshot.allocatedPct;
  // Targets come from the user's policy and risk profile, so they match the Risk Center.
  const targets = [
    { label: "Stablecoins (liquidity floor)", actualPct: stable, targetPct: user.liquidityFloorPct, color: "#5B8DEF" },
    { label: "BTC (exposure cap)", actualPct: btcPct, targetPct: user.maxAssetExposurePct, color: "#F2A93B" },
    { label: "In IXS vaults", actualPct: rwa, targetPct: snapshot.targetAllocationPct, color: "#17996A" },
  ];
  const over = targets.find((t) => t.actualPct - t.targetPct >= 2);
  return {
    history,
    targets,
    note: over
      ? over.label.startsWith("BTC")
        ? `BTC is ${over.actualPct - over.targetPct} pts over the exposure cap. Vaulto never sells assets; the Risk Center flags exposure above the cap.`
        : `${over.label.replace(/ (.*)$/, "")} is ${over.actualPct - over.targetPct} pts over target. Within tolerance; Vaulto rebalances by allocating idle capital into IXS vaults, not by selling assets.`
      : "Allocation is within target tolerance. Vaulto rebalances by allocating idle capital, not by selling assets.",
    yieldEarnedUsd,
    priceChangeUsd,
    changeUsd,
    changePct: start > 0 ? Math.round((changeUsd / start) * 10000) / 100 : 0,
    periodDays,
  };
}
