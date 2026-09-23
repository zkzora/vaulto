import type { TreasurySnapshot, UserProfile, VaultStrategy } from "@/lib/types";

export interface Candidate {
  strategy: VaultStrategy;
  asset: string;
  idleAmount: number;
  idleUsd: number;
  apyGain: number; // vs 0% idle
  fitScore: number;
  notes: string[];
}

/**
 * Opportunity Finder Agent — matches idle assets to IXS RWA strategies and ranks fit.
 */
export function findOpportunities(snapshot: TreasurySnapshot, strategies: VaultStrategy[], user: UserProfile): Candidate[] {
  const idleAssets = snapshot.assets.filter((a) => a.idle && a.idleUsd > 0);
  const out: Candidate[] = [];
  for (const s of strategies) {
    if (s.status !== "active" || s.apy == null) continue;
    const idle = idleAssets.find((a) => a.symbol === s.asset);
    if (!idle) continue;
    const notes: string[] = [];
    let fit = s.apy * 10 + s.riskScore * 0.4;
    if (s.chainId === snapshot.chainId && s.executable) {
      fit += 12;
      notes.push("Executable on the connected network");
    }
    if (s.requiresWhitelist) {
      fit -= 15;
      notes.push("Whitelist required");
    }
    if (user.riskProfile === "Conservative" && s.riskScore < 90) fit -= 10;
    if (user.riskProfile === "Growth") fit += (s.apy - 4) * 4;
    if (s.settlement === "async-erc7540") notes.push("Async settlement (request → claim)");
    out.push({
      strategy: s,
      asset: s.asset,
      idleAmount: idle.idleAmount,
      idleUsd: idle.idleUsd,
      apyGain: s.apy,
      fitScore: Math.round(fit),
      notes,
    });
  }
  return out.sort((a, b) => b.fitScore - a.fitScore);
}
