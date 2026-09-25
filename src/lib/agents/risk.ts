import { fmtAmount } from "@/lib/format";
import { CHAIN_NAME, NATIVE_SYMBOL } from "@/lib/chain/config";
import type { RejectedOption, TreasurySnapshot, UserProfile, VaultPreflight } from "@/lib/types";
import type { Candidate } from "./finder";

export type Verdict = "allocate" | "defer" | "reject";

/** Everything SERV reasoning needs to know about one candidate, as facts (no decision taken here). */
export interface Assessment {
  candidate: Candidate;
  preflight: VaultPreflight | null;
  /** Deterministic hint derived from the facts; SERV makes the call and writes the reason. */
  verdictHint: Verdict;
  facts: string[];
}

export interface RiskVerdict {
  assessments: Assessment[];
  /** Candidates whose pre-flight and policy checks pass: the only ones the Planner will cap. */
  approved: Candidate[];
  /** Deterministic fallback wording, used only when SERV reasoning is unavailable (labelled "local"). */
  fallbackDecisions: { strategyId: string; verdict: Verdict; reason: string }[];
  /** Non-candidate notes (idle gas, unmatched assets). */
  notes: RejectedOption[];
  policyChecks: { label: string; ok: boolean; detail: string }[];
}

/**
 * Risk Guardian Agent — assembles the facts every allocation decision rests on: vault availability
 * (IXS Vault API), pre-flight checks (limit, NAV age, minimum deposit, MCP build probe, eligibility, cutoff),
 * policy (risk score, exposure, liquidity floor). It does not decide: SERV reasoning does, with explicit reasons.
 */
export function assessCandidates(candidates: Candidate[], snapshot: TreasurySnapshot, user: UserProfile, preflights: Record<string, VaultPreflight>): RiskVerdict {
  const assessments: Assessment[] = [];
  const approved: Candidate[] = [];
  const fallbackDecisions: RiskVerdict["fallbackDecisions"] = [];

  for (const c of candidates) {
    const s = c.strategy;
    const p = preflights[s.id] ?? null;
    const facts: string[] = [];
    let hint: Verdict = "allocate";
    let reason = "";

    if (!c.available) {
      hint = "reject";
      reason = `Announced by IXS, no ${c.asset} vault deployed on the IXS Vault API`;
      facts.push(reason);
    } else if (!p) {
      hint = "reject";
      reason = "Pre-flight could not run (vault state unavailable)";
      facts.push(reason);
    } else {
      for (const ch of p.checks) facts.push(`${ch.label}: ${ch.value}${ch.ok ? "" : " (fails)"} · ${ch.source}`);
      if (p.verdict === "reject") {
        hint = "reject";
        reason = p.checks.filter((ch) => ch.severity === "block" && !ch.ok).map((ch) => `${ch.label}: ${ch.detail}`).join("; ");
      } else if (p.verdict === "defer") {
        hint = "defer";
        reason = `Temporarily paused — waiting NAV refresh (${p.checks.filter((ch) => ch.severity === "defer" && !ch.ok).map((ch) => `${ch.label.toLowerCase()} ${ch.value}`).join(", ")}; IXS stated on 24 Sep 2026 that a 0 limit relates to NAV staleness, and Vaulto policy defers such vaults)`;
      }
    }
    if (hint === "allocate" && s.riskScore < user.minVaultRiskScore) {
      hint = "reject";
      reason = `Risk score ${s.riskScore} below your ${user.minVaultRiskScore} minimum`;
      facts.push(reason);
    }
    const minDeposit = s.terms?.minDepositUsd ?? 0;
    if (hint === "allocate" && minDeposit > 0 && c.idleUsd < minDeposit) {
      hint = "reject";
      reason = `Idle ${fmtAmount(c.idleAmount, c.asset)} is below the IXS minimum deposit of ${minDeposit} ${c.asset}`;
      facts.push(reason);
    }
    facts.push(`Policy: risk score ${s.riskScore} vs minimum ${user.minVaultRiskScore}; chain ${s.chainName}; settlement ${s.settlement}`);
    assessments.push({ candidate: c, preflight: p, verdictHint: hint, facts });
    if (hint === "allocate") approved.push(c);
    else fallbackDecisions.push({ strategyId: s.id, verdict: hint, reason });
  }

  const notes: RejectedOption[] = [];
  for (const a of snapshot.assets) {
    if (!a.idle || a.idleUsd < 50 || candidates.some((c) => c.asset === a.symbol)) continue;
    if (a.symbol === NATIVE_SYMBOL || a.symbol === "AVAX") continue; // gas reserve, never allocated
    notes.push({ option: `Idle ${fmtAmount(a.idleAmount, a.symbol)}`, reason: "No IXS vault for this asset", tone: "muted" });
  }
  if (!candidates.length) {
    const gas = snapshot.assets.find((a) => a.symbol === NATIVE_SYMBOL && a.idleAmount > 0);
    if (gas) notes.push({ option: `Idle ${fmtAmount(gas.idleAmount, gas.symbol)}`, reason: `Gas reserve on ${CHAIN_NAME}; no IXS vault takes ${NATIVE_SYMBOL}`, tone: "muted" });
  }

  const policyChecks = [
    { label: "Liquidity floor", ok: snapshot.liquidPct >= user.liquidityFloorPct, detail: `${snapshot.liquidPct}% liquid vs ${user.liquidityFloorPct}% floor` },
    { label: "Asset exposure", ok: snapshot.maxExposure.pct <= user.maxAssetExposurePct, detail: `${snapshot.maxExposure.symbol} ${snapshot.maxExposure.pct}% vs ${user.maxAssetExposurePct}% limit` },
    { label: "Vault risk", ok: approved.every((c) => c.strategy.riskScore >= user.minVaultRiskScore), detail: approved.length ? `Lowest approved score ${Math.min(...approved.map((c) => c.strategy.riskScore))}` : "No candidate passed pre-flight" },
    {
      label: "Pre-flight (limit, NAV, minimum, eligibility)",
      ok: approved.length > 0,
      detail: assessments.map((a) => `${a.candidate.strategy.vaultName}: ${a.verdictHint}${a.preflight ? ` (limit ${a.preflight.depositLimitUnlimited ? "unlimited" : (a.preflight.depositLimitUsd ?? "?")}, NAV ${a.preflight.navAgeHours != null ? `${(a.preflight.navAgeHours / 24).toFixed(1)} d` : "?"})` : ""}`).join("; "),
    },
  ];

  return { assessments, approved, fallbackDecisions, notes, policyChecks };
}
