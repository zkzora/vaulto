import { fmtAmount } from "@/lib/format";
import { CHAIN_NAME, NATIVE_SYMBOL } from "@/lib/chain/config";
import type { RejectedOption, TreasurySnapshot, UserProfile } from "@/lib/types";
import type { Candidate } from "./finder";

export interface RiskVerdict {
  approved: Candidate[];
  rejected: RejectedOption[];
  policyChecks: { label: string; ok: boolean; detail: string }[];
}

/**
 * Risk Guardian Agent — evaluates vault availability, eligibility, liquidity, exposure and policy.
 * `whitelist` holds eligibility results from the IXS MCP `vault_check_whitelist` tool.
 * `availability` holds the live IXS Vault API check per strategy id (true = a vault for that asset is deployed).
 */
export function guardCandidates(
  candidates: Candidate[],
  snapshot: TreasurySnapshot,
  user: UserProfile,
  whitelist: Record<string, boolean | null> = {},
  availability: Record<string, { available: boolean; detail: string }> = {},
): RiskVerdict {
  const approved: Candidate[] = [];
  const rejected: RejectedOption[] = [];
  const seenAsset = new Set<string>();

  for (const c of candidates) {
    const s = c.strategy;
    const label = `${s.vaultName}${s.apy != null ? ` · ${s.apy.toFixed(1)}%` : ""}`;
    const avail = availability[s.id];
    if (!c.available || (avail && !avail.available)) {
      rejected.push({
        option: `${label} · idle ${fmtAmount(c.idleAmount, c.asset)}`,
        reason: avail?.detail ?? "Announced by IXS, no vault deployed yet",
        tone: "warn",
      });
      continue;
    }
    if (s.riskScore < user.minVaultRiskScore) {
      rejected.push({ option: label, reason: `Risk score ${s.riskScore} below your ${user.minVaultRiskScore} minimum`, tone: "warn" });
      continue;
    }
    if (s.requiresWhitelist && whitelist[s.id] !== true) {
      rejected.push({ option: label, reason: whitelist[s.id] === false ? "Wallet not whitelisted (IXS MCP check)" : "Eligibility check pending", tone: "warn" });
      continue;
    }
    if (s.chainId !== snapshot.chainId) {
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

  // Idle assets with no IXS strategy at all (e.g. gas token) are named so the reasoning can explain them.
  for (const a of snapshot.assets) {
    if (!a.idle || a.idleUsd < 50 || candidates.some((c) => c.asset === a.symbol)) continue;
    if (a.symbol === NATIVE_SYMBOL) continue; // gas reserve, never allocated
    rejected.push({ option: `Idle ${fmtAmount(a.idleAmount, a.symbol)}`, reason: "No IXS vault for this asset", tone: "muted" });
  }

  // Nothing allocatable at all (e.g. a wallet that only holds gas): say so instead of a generic floor breach.
  if (!approved.length && !rejected.length) {
    const gas = snapshot.assets.find((a) => a.symbol === NATIVE_SYMBOL && a.idleAmount > 0);
    if (gas) rejected.push({ option: `Idle ${fmtAmount(gas.idleAmount, gas.symbol)}`, reason: `Gas reserve on ${CHAIN_NAME}; no IXS vault takes ${NATIVE_SYMBOL}`, tone: "muted" });
  }

  // Evaluate the naive alternative (only when there is something to allocate) so the user sees why Vaulto sizes conservatively.
  if (approved.length && snapshot.idlePct > user.liquidityFloorPct) {
    rejected.push({ option: "Allocate all idle capital", reason: `Breaks ${user.liquidityFloorPct}% liquidity floor`, tone: "warn" });
  }

  const unavailable = Object.values(availability).filter((a) => !a.available);
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
    {
      label: "IXS vault availability",
      ok: true,
      detail: unavailable.length ? unavailable.map((a) => a.detail).join("; ") : "All candidate vaults are live on the IXS Vault API",
    },
  ];

  return { approved, rejected, policyChecks };
}
