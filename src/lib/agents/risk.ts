import type { RejectedOption, TreasurySnapshot, UserProfile } from "@/lib/types";
import type { Candidate } from "./finder";

export interface RiskVerdict {
  approved: Candidate[];
  rejected: RejectedOption[];
  policyChecks: { label: string; ok: boolean; detail: string }[];
}

/**
 * Risk Guardian Agent — evaluates liquidity, vault, exposure and policy compliance.
 * `whitelist` holds eligibility results from the IXS MCP `vault_check_whitelist` tool.
 */
export function guardCandidates(
  candidates: Candidate[],
  snapshot: TreasurySnapshot,
  user: UserProfile,
  whitelist: Record<string, boolean | null> = {},
): RiskVerdict {
  const approved: Candidate[] = [];
  const rejected: RejectedOption[] = [];
  const seenAsset = new Set<string>();

  for (const c of candidates) {
    const s = c.strategy;
    const label = `${s.vaultName} · ${s.apy?.toFixed(1)}%`;
    if (s.riskScore < user.minVaultRiskScore) {
      rejected.push({ option: label, reason: `Risk score ${s.riskScore} below your ${user.minVaultRiskScore} minimum`, tone: "warn" });
      continue;
    }
    if (s.requiresWhitelist && whitelist[s.id] !== true) {
      rejected.push({ option: label, reason: whitelist[s.id] === false ? "Wallet not eligible" : "Eligibility check pending", tone: "warn" });
      continue;
    }
    if (s.source === "live" && s.chainId !== snapshot.chainId) {
      rejected.push({ option: `${s.vaultName} (${s.chainName})`, reason: "Different network than the connected treasury", tone: "muted" });
      continue;
    }
    if (seenAsset.has(c.asset)) {
      rejected.push({ option: label, reason: `Lower fit than the selected ${c.asset} strategy`, tone: "muted" });
      continue;
    }
    seenAsset.add(c.asset);
    approved.push(c);
  }

  // Always evaluate the naive alternative so the user sees why Vaulto sizes conservatively.
  if (snapshot.idlePct > user.liquidityFloorPct) {
    rejected.push({ option: "Allocate all idle capital", reason: `Breaks ${user.liquidityFloorPct}% liquidity floor`, tone: "warn" });
  }

  const policyChecks = [
    {
      label: "Liquidity floor",
      ok: snapshot.liquidPct >= user.liquidityFloorPct,
      detail: `${snapshot.liquidPct}% liquid vs ${user.liquidityFloorPct}% floor`,
    },
    {
      label: "Asset exposure",
      ok: snapshot.maxExposure.pct <= user.maxAssetExposurePct,
      detail: `${snapshot.maxExposure.symbol} ${snapshot.maxExposure.pct}% vs ${user.maxAssetExposurePct}% limit`,
    },
    {
      label: "Vault risk",
      ok: approved.every((c) => c.strategy.riskScore >= user.minVaultRiskScore),
      detail: approved.length ? `Lowest approved score ${Math.min(...approved.map((c) => c.strategy.riskScore))}` : "No candidates",
    },
  ];

  return { approved, rejected, policyChecks };
}
