import type { TreasurySnapshot, UserProfile, VaultStrategy } from "@/lib/types";

export interface Candidate {
  strategy: VaultStrategy;
  asset: string;
  idleAmount: number;
  idleUsd: number;
  apyGain: number; // vs 0% idle
  fitScore: number;
  notes: string[];
  /** False when IXS has announced the product but no vault is deployed (checked against the IXS Vault API). */
  available: boolean;
}

/**
 * Opportunity Finder Agent — matches idle assets to IXS strategies and ranks fit.
 * Announced-but-undeployed products (e.g. BTC Real Yield) are surfaced as unavailable candidates so the
 * Risk Guardian and SERV reasoning can reject them explicitly instead of silently ignoring idle BTC.
 */
export function findOpportunities(snapshot: TreasurySnapshot, strategies: VaultStrategy[], user: UserProfile): Candidate[] {
  const idleAssets = snapshot.assets.filter((a) => a.idle && a.idleUsd > 0);
  const out: Candidate[] = [];
  for (const s of strategies) {
    const idle = idleAssets.find((a) => a.symbol === s.asset);
    if (!idle) continue;
    const available = s.status === "active" && s.availability !== "announced";
    const notes: string[] = [];
    let fit = (s.apy ?? 0) * 10 + s.riskScore * 0.4;
    if (available && s.chainId === snapshot.chainId && s.executable) {
      fit += 12;
      notes.push("Executable on the connected network via IXS MCP");
    }
    if (s.requiresWhitelist) {
      fit -= 15;
      notes.push("Whitelist required");
    }
    if (!available) {
      fit = 0;
      notes.push("Announced by IXS, no vault deployed yet");
    }
    if (user.riskProfile === "Conservative" && s.riskScore < 90) fit -= 10;
    if (user.riskProfile === "Growth") fit += ((s.apy ?? 0) - 4) * 4;
    if (s.settlement === "async-erc7540") notes.push("Async settlement (request → claim)");
    out.push({
      strategy: s,
      asset: s.asset,
      idleAmount: idle.idleAmount,
      idleUsd: idle.idleUsd,
      apyGain: s.apy ?? 0,
      fitScore: Math.round(fit),
      notes,
      available,
    });
  }
  return out.sort((a, b) => b.fitScore - a.fitScore);
}
