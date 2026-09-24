import { chainInfo } from "@/lib/chain/config";
import { env, openservConfigured } from "@/lib/env";
import { recordEvidence } from "@/lib/evidence";
import { fmtAmount, fmtUsd } from "@/lib/format";
import type { AllocationLeg, Memo, Metrics, RejectedOption, TreasurySnapshot, UserProfile } from "@/lib/types";
import type { Assessment, Verdict } from "@/lib/agents/risk";
import type { Constraints, LegInput } from "@/lib/agents/planner";
import type { CutoffInfo } from "@/lib/ixs/cutoff";
import { chatCompletion } from "./inference";
import { runOpenServTask } from "./platform";

/**
 * SERV reasoning (OpenServ). Two calls per analysis:
 *  1. decideAllocation — reads the pre-flight facts of every candidate vault and returns a verdict per vault
 *     (ALLOCATE with an amount within the Planner's caps, DEFER, or REJECT) with an explicit reason, plus a rationale.
 *  2. narrate — writes the explanation and the investment-committee memo from the validated plan.
 * Both calls, their exact inputs and raw outputs are kept in the evidence log and on the recommendation (trace).
 * When OpenServ is unavailable the deterministic engine takes over and everything is labelled "local".
 */

export const VAULTO_SYSTEM_PROMPT = `You are Vaulto, an AI treasury allocation agent running on OpenServ (SERV reasoning).
You coordinate six agents: Treasury Scanner, Opportunity Finder, Risk Guardian, Allocation Planner, Execution and Monitoring.
You reason about DAO / Web3 company treasuries and allocate idle capital into the IXS Finance IX High Yield Bond vaults (USDC) on BNB Chain and Avalanche mainnet.
Rules: never execute or move funds; only decide, explain and recommend. Never propose selling assets to chase yield.
Every candidate vault comes with pre-flight facts read from the IXS MCP, the contracts and the IXS subgraph. Verdicts:
- ALLOCATE only when every pre-flight check passes; the amount must be within the Planner's cap for that vault (never above maxAmount, never below the 100 USDC minimum confirmed by IXS). You may split an allocation across several open vaults according to their deposit limits.
- DEFER ("temporarily paused — waiting NAV refresh") when the deposit limit is 0 or the NAV is stale: per IXS (24 Sep 2026) a limit of 0 is the NAV-staleness effect between updates, not a closed vault. Say what would unblock it.
- REJECT when the wallet is not whitelisted, the vault is paused, the product is announced but not deployed (e.g. BTC Real Yield), the risk score is below policy, or the idle balance is below the minimum deposit. Give the concrete reason.
Never skip a candidate silently: every candidate gets exactly one verdict and reason.
Settlement facts: sync ERC-4626 vaults mint shares in the deposit transaction; async ERC-7540 vaults process requests at the daily cutoff 17:00 SGT (09:00 UTC) on Singapore business days and settle about one business day later. Redemptions: request → awaiting RWA sale & operator finalization → paid (no claim step), 0.5% redemption fee.
Deposits are "Simulated on <chain> mainnet" (eth_call + state override against the real vault) until the wallet holds 100 USDC on that chain, then signed live; the decision logic is identical in both modes.
Respect the liquidity floor, asset exposure limit, minimum vault risk score and the stablecoin runway reserve.
Framing: SERV decides; deterministic policy guardrails enforce hard limits (liquidity floor, exposure cap, minimum vault score, minimum deposit, per-transaction Live cap, NAV staleness). Stay inside them so no validator override is needed.
Write in plain, confident language for a treasury manager. Be specific with numbers and never invent figures.`;

/* ------------------------------------------------------------------ decision ------------------------------------------------------------------ */

export interface DecisionInput {
  user: UserProfile;
  snapshot: TreasurySnapshot;
  assessments: Assessment[];
  constraints: Constraints | null;
  policyChecks: { label: string; ok: boolean; detail: string }[];
  /** Deterministic fallback sizing, also shown to SERV as a reference. */
  fallback: LegInput[];
  /** Deterministic fallback verdicts for candidates that fail pre-flight / policy. */
  fallbackDecisions: { strategyId: string; verdict: Verdict; reason: string }[];
  cutoff: CutoffInfo;
}

export interface VaultDecision {
  strategyId: string;
  verdict: Verdict;
  amount?: number;
  reason: string;
}

export interface Decision {
  legs: LegInput[];
  decisions: VaultDecision[];
  rationale: string;
  source: "openserv" | "local";
  model?: string;
  input: unknown;
  output: unknown;
}

function decisionFacts(i: DecisionInput) {
  const capOf = (id: string) => i.constraints?.caps.find((c) => c.strategyId === id) ?? null;
  return {
    policy: {
      riskProfile: i.user.riskProfile,
      liquidityFloorPct: i.user.liquidityFloorPct,
      maxAssetExposurePct: i.user.maxAssetExposurePct,
      minVaultRiskScore: i.user.minVaultRiskScore,
      monthlyBurnUsd: i.user.monthlyBurnUsd,
      treasuryGoal: i.user.treasuryGoal,
    },
    treasury: {
      totalUsd: i.snapshot.totalUsd,
      idleUsd: i.snapshot.idleUsd,
      idlePct: i.snapshot.idlePct,
      idleDays: i.snapshot.idleDays,
      executionMode: i.snapshot.executionMode,
      liveChainIds: i.snapshot.liveChainIds,
      assets: i.snapshot.assets.map((a) => ({ symbol: a.symbol, valueUsd: a.valueUsd, idleAmount: a.idleAmount, idleUsd: a.idleUsd, deployedIn: a.deployedIn })),
      positions: i.snapshot.positions.map((p) => ({ vault: p.vaultName, asset: p.asset, valueUsd: p.valueUsd, apy: p.apy })),
      maxExposure: i.snapshot.maxExposure,
    },
    candidates: i.assessments.map((a) => {
      const s = a.candidate.strategy;
      const cap = capOf(s.id);
      return {
        strategyId: s.id,
        vault: s.vaultName,
        chain: s.chainName,
        asset: a.candidate.asset,
        idleAmount: a.candidate.idleAmount,
        idleUsd: a.candidate.idleUsd,
        yieldTtmPct: s.apy,
        riskScore: s.riskScore,
        settlement: s.settlement,
        deployed: a.candidate.available,
        preflight: a.preflight
          ? { verdictHint: a.preflight.verdict, depositLimit: a.preflight.depositLimitUnlimited ? "unlimited" : a.preflight.depositLimitUsd, navAgeHours: a.preflight.navAgeHours, navUpdatedAt: a.preflight.navUpdatedAt, minDepositUsd: a.preflight.minDepositUsd, whitelisted: a.preflight.whitelisted, mcpAccepts: a.preflight.mcpAccepts, mcpReason: a.preflight.mcpReason, checks: a.preflight.checks.map((c) => ({ key: c.key, label: c.label, ok: c.ok, severity: c.severity, value: c.value, detail: c.detail, source: c.source })) }
          : { verdictHint: a.verdictHint, note: "no vault deployed on the IXS Vault API" },
        policyFacts: a.facts,
        cap: cap ? { maxAmount: cap.maxAmount, maxUsd: cap.maxUsd, depositLimitUsd: cap.depositLimitUsd, note: cap.capNote } : null,
      };
    }),
    constraints: i.constraints
      ? { budgetUsd: i.constraints.budgetUsd, keepLiquidUsd: i.constraints.keepLiquidUsd, stableReserveUsd: i.constraints.stableReserveUsd, minDepositUsd: i.constraints.minDepositUsd }
      : null,
    guardrails: { framing: "SERV decides; deterministic policy guardrails enforce hard limits", liveMaxPerTxUsdc: env.maxLiveTxUsdc, navStaleHours: env.navStaleHours, minDepositUsdc: 100 },
    policyChecks: i.policyChecks,
    nextCutoff: { utc: i.cutoff.nextCutoffUtc, sgt: i.cutoff.nextCutoffSgt, hoursUntil: i.cutoff.hoursUntilCutoff, estimatedSettlementSgt: i.cutoff.estimatedSettlementSgt, source: i.cutoff.source },
    fallbackSizing: i.fallback,
  };
}

function extractJson<T>(text: string): T | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

function localDecision(input: DecisionInput, facts: unknown, note: string): Decision {
  const decisions: VaultDecision[] = [];
  for (const a of input.assessments) {
    const id = a.candidate.strategy.id;
    const fb = input.fallbackDecisions.find((d) => d.strategyId === id);
    const leg = input.fallback.find((l) => l.strategyId === id);
    if (fb) decisions.push({ strategyId: id, verdict: fb.verdict, reason: fb.reason });
    else if (leg && leg.amount > 0) decisions.push({ strategyId: id, verdict: "allocate", amount: leg.amount, reason: "Passes every pre-flight check and the policy; sized by the deterministic engine within the Planner's cap." });
    else decisions.push({ strategyId: id, verdict: "defer", reason: "Passes pre-flight but no budget remains above the liquidity floor and runway reserve." });
  }
  return { legs: input.fallback, decisions, rationale: note, source: "local", input: facts, output: { decisions, note } };
}

/**
 * SERV reasoning, step 1 — one verdict per candidate vault (ALLOCATE / DEFER / REJECT) with a reason, and the
 * allocation amounts within the Planner's caps. Falls back to the deterministic engine when OpenServ is unavailable.
 */
export async function decideAllocation(input: DecisionInput): Promise<Decision> {
  const facts = decisionFacts(input);
  if (!openservConfigured() || env.openservReasoningMode === "platform") return localDecision(input, facts, "Deterministic decision (SERV reasoning unavailable).");
  const prompt = `DECIDE for every candidate vault. Facts (JSON):\n${JSON.stringify(facts)}\n\nRules: return exactly one decision per candidate strategyId. verdict is "allocate", "defer" or "reject". For "allocate" give amount (asset units) between the 100 USDC minimum and cap.maxAmount; the USD sum of all allocations must not exceed constraints.budgetUsd; you may allocate less if prudence requires it and may split across open vaults by their deposit limits. Use "defer" for limit 0 / stale NAV (waiting NAV refresh) and "reject" for whitelist, pause, announced-not-deployed, risk score or minimum-deposit failures. Every reason must cite the concrete fact (numbers, timestamps, chain). Respond with ONLY JSON: {"decisions":[{"strategyId":string,"verdict":"allocate"|"defer"|"reject","amount":number,"reason":string}],"rationale":string (2-3 sentences)}`;
  const started = Date.now();
  try {
    const r = await chatCompletion({ messages: [{ role: "system", content: VAULTO_SYSTEM_PROMPT }, { role: "user", content: prompt }], temperature: 0.1 });
    const json = extractJson<{ decisions?: { strategyId: string; verdict: string; amount?: number; reason?: string }[]; rationale?: string }>(r.content);
    recordEvidence({ kind: "serv", label: `SERV reasoning · decision (${r.model})`, request: { model: r.model, system: VAULTO_SYSTEM_PROMPT, facts }, response: json ?? r.content, ok: Boolean(json?.decisions), durationMs: Date.now() - started });
    if (!json?.decisions?.length) return localDecision(input, facts, "SERV reasoning returned no parseable decision; deterministic engine used.");
    const known = new Map(input.assessments.map((a) => [a.candidate.strategy.id, a]));
    const decisions: VaultDecision[] = [];
    for (const d of json.decisions) {
      const a = known.get(d.strategyId);
      if (!a) continue;
      const verdict: Verdict = d.verdict === "allocate" || d.verdict === "defer" || d.verdict === "reject" ? d.verdict : a.verdictHint;
      decisions.push({ strategyId: d.strategyId, verdict, amount: verdict === "allocate" && typeof d.amount === "number" && d.amount > 0 ? d.amount : undefined, reason: (d.reason ?? "").trim() || "No reason given by SERV; validator applied the pre-flight facts." });
    }
    // Every candidate gets a verdict: fill the ones SERV skipped from the deterministic facts and say so.
    for (const a of input.assessments) {
      const id = a.candidate.strategy.id;
      if (decisions.some((d) => d.strategyId === id)) continue;
      const fb = input.fallbackDecisions.find((d) => d.strategyId === id);
      decisions.push({ strategyId: id, verdict: fb?.verdict ?? "defer", reason: `${fb?.reason ?? "Not addressed by SERV"} (validator: candidate missing from the SERV output)` });
    }
    const legs = decisions.filter((d) => d.verdict === "allocate" && d.amount).map((d) => ({ strategyId: d.strategyId, amount: d.amount! }));
    return { legs, decisions, rationale: json.rationale ?? "", source: "openserv", model: r.model, input: facts, output: json };
  } catch (e) {
    console.warn("[openserv] decision fell back to local engine:", e instanceof Error ? e.message : e);
    recordEvidence({ kind: "serv", label: "SERV reasoning · decision", request: { facts }, response: { error: e instanceof Error ? e.message : String(e) }, ok: false, durationMs: Date.now() - started });
    return localDecision(input, facts, `Deterministic decision (SERV reasoning error: ${e instanceof Error ? e.message : "unknown"}).`);
  }
}

/* ------------------------------------------------------------------ narrative + memo ------------------------------------------------------------------ */

export interface NarrativeInput {
  user: UserProfile;
  snapshot: TreasurySnapshot;
  assessments: Assessment[];
  decisions: VaultDecision[];
  legs: AllocationLeg[];
  before: Metrics;
  after: Metrics;
  rejected: RejectedOption[];
  deferred: RejectedOption[];
  extraMonthlyUsd: number;
  totalUsd: number;
  policyChecks: { label: string; ok: boolean; detail: string }[];
  decisionRationale?: string;
  cutoff: CutoffInfo;
}

export interface Narrative {
  title: string;
  headline: string;
  summary: string;
  reasons: { title: string; body: string }[];
  steps: { agent: string; title: string; body: string }[];
  memo: Memo;
  confidence: number;
  source: "openserv" | "local";
  model?: string;
  input?: unknown;
  output?: unknown;
}

const vaultOf = (i: NarrativeInput, id: string) => i.assessments.find((a) => a.candidate.strategy.id === id)?.candidate.strategy;

/** Deterministic memo (used when OpenServ is unavailable, and as the skeleton SERV must follow). */
export function localMemo(i: NarrativeInput): Memo {
  const { snapshot, user, legs } = i;
  const legText = legs.length ? legs.map((l) => `${fmtAmount(l.amount, l.asset)} (≈ ${fmtUsd(l.amountUsd)}) → ${l.vaultName} on ${l.chainName} at ${l.apy}% TTM`).join("; ") : "none";
  const asyncLegs = legs.filter((l) => vaultOf(i, l.strategyId)?.settlement === "async-erc7540");
  return {
    title: `Allocation memo · ${new Date().toISOString().slice(0, 10)}`,
    sections: [
      { heading: "Treasury condition", body: `Total ${fmtUsd(snapshot.totalUsd)}; idle ${fmtUsd(snapshot.idleUsd)} (${snapshot.idlePct}%) for ${snapshot.idleDays} days: ${snapshot.assets.filter((a) => a.idle).map((a) => fmtAmount(a.idleAmount, a.symbol)).join(" + ")}. ${snapshot.positions.length} existing IXS position${snapshot.positions.length === 1 ? "" : "s"} (${fmtUsd(snapshot.allocatedUsd)}). Execution mode: ${snapshot.executionMode}.` },
      { heading: "Policy", body: `SERV decides; deterministic policy guardrails enforce hard limits: liquidity floor ${user.liquidityFloorPct}%, max single-asset exposure ${user.maxAssetExposurePct}%, minimum vault risk score ${user.minVaultRiskScore}, minimum deposit 100 USDC per request (confirmed by IXS), Live cap ${env.maxLiveTxUsdc.toLocaleString("en-US")} USDC per transaction, NAV stale after ${env.navStaleHours} h. Monthly burn ${fmtUsd(user.monthlyBurnUsd)}. ${i.policyChecks.map((c) => `${c.label}: ${c.detail}`).join("; ")}.` },
      { heading: "Proposed allocation", body: legs.length ? `${legText}. Liquidity ${i.before.liquidPct}% → ${i.after.liquidPct}%, blended yield ${i.before.blendedApy.toFixed(1)}% → ${i.after.blendedApy.toFixed(1)}%, about ${fmtUsd(i.extraMonthlyUsd)} extra per month. ${i.decisionRationale ?? ""}` : `No allocation now. ${i.decisionRationale ?? ""}` },
      { heading: "Deferred (waiting NAV refresh)", body: i.deferred.length ? i.deferred.map((d) => `${d.option}: ${d.reason}`).join(" · ") : "None." },
      { heading: "Rejected", body: i.rejected.length ? i.rejected.map((r) => `${r.option}: ${r.reason}`).join(" · ") : "None." },
      { heading: "Risks", body: "RWA credit risk: the vault holds U.S. Treasuries and high-yield corporate bonds through a licensed structure; returns depend on their performance and are not guaranteed. Redemptions are queued for the operator (request → awaiting RWA sale & operator finalization → paid, no claim step) with a 0.5% redemption fee read from feeBps(); NAV is updated periodically off-chain, so entry and exit prices can drift between updates. Smart-contract and counterparty risk apply." },
      { heading: "Execution", body: `${legs.length ? `${legs.length} deposit${legs.length > 1 ? "s" : ""}: approve exact amount + ${asyncLegs.length ? "requestDeposit" : "deposit"} built by the IXS MCP. ` : ""}${asyncLegs.length ? `Async vaults: send before the next cutoff ${i.cutoff.nextCutoffSgt} (in ${i.cutoff.hoursUntilCutoff} h) to be processed then; estimated settlement ${i.cutoff.estimatedSettlementSgt} (${i.cutoff.holidayAssumption}). ` : ""}${snapshot.executionMode === "live" ? "Live: the wallet signs on the vault's chain, capped per transaction." : "Simulated: eth_call + state override against the real vault; nothing moves until the wallet holds 100 USDC on that chain."}` },
    ],
  };
}

/** Deterministic narrative used when OpenServ is not configured (or as fallback). */
export function localNarrative(i: NarrativeInput): Narrative {
  const { snapshot, user, legs, before, after, deferred, rejected } = i;
  const legText = legs.map((l) => `${fmtAmount(l.amount, l.asset)} into ${l.vaultName} (${l.apy.toFixed(2)}%)`).join(" and ") || "nothing";
  const idleText = snapshot.assets.filter((a) => a.idle).map((a) => fmtAmount(a.idleAmount, a.symbol)).join(" and ");
  const scores = legs.map((l) => l.riskScore);
  const passesAll = i.policyChecks.every((c) => c.ok);
  const confidence = Math.min(97, Math.max(70, Math.round(80 + (passesAll ? 8 : -6) + Math.min(scores.length ? Math.min(...scores) : 80, 100) * 0.06 - (snapshot.onchain.rpcOk ? 0 : 3))));
  return {
    title: legs.length ? "Allocate idle treasury capital" : "Hold: no vault passes pre-flight",
    headline: legs.length ? `Allocate ${fmtUsd(i.totalUsd)} into IXS vaults and keep a ${after.liquidPct}% liquidity reserve` : "Every candidate vault is deferred or rejected; capital stays liquid",
    summary: `Your treasury has ${fmtUsd(snapshot.idleUsd)} idle (${snapshot.idlePct}%). Based on your ${user.liquidityFloorPct}% liquidity floor and ${user.riskProfile.toLowerCase()} risk policy, Vaulto recommends ${legText}.${deferred.length ? ` Deferred: ${deferred.map((d) => d.option.split(" · ")[0]).join(", ")} (waiting NAV refresh).` : ""}${rejected.length ? ` Rejected: ${rejected.map((r) => r.option.split(" · ")[0]).join(", ")}.` : ""} Liquidity stays at ${after.liquidPct}% and blended yield moves from ${before.blendedApy.toFixed(1)}% to ${after.blendedApy.toFixed(1)}%.`,
    reasons: [
      { title: "Improves capital efficiency.", body: `${idleText} (≈ ${fmtUsd(snapshot.idleUsd)}) have sat idle for ${snapshot.idleDays} days earning nothing. Deploying ${fmtUsd(i.totalUsd)} adds about ${fmtUsd(i.extraMonthlyUsd)} per month.` },
      { title: "Maintains required liquidity.", body: `Treasury stays ${after.liquidPct}% liquid, above your ${user.liquidityFloorPct}% floor${user.monthlyBurnUsd > 0 ? `, and two months of burn stay in stablecoins` : ""}.` },
      { title: "Every vault got a verdict.", body: i.decisions.map((d) => `${vaultOf(i, d.strategyId)?.vaultName ?? d.strategyId}: ${d.verdict}${d.verdict === "allocate" && d.amount ? ` ${d.amount.toLocaleString("en-US")}` : ""} — ${d.reason}`).join(" · ") },
    ],
    steps: [
      { agent: "Treasury Scanner + Opportunity Finder", title: "Detected idle capital", body: `${snapshot.idlePct}% of capital is idle: ${idleText}. ${i.assessments.length} candidate vault${i.assessments.length === 1 ? "" : "s"} matched on the IXS Vault API (BNB Chain + Avalanche).` },
      { agent: "Risk Guardian", title: "Ran the pre-flight checks", body: i.assessments.map((a) => `${a.candidate.strategy.vaultName}: ${a.preflight ? a.preflight.checks.filter((c) => c.severity !== "info").map((c) => `${c.label} ${c.ok ? "ok" : "fails"} (${c.value})`).join(", ") : "no vault deployed"}`).join(" · ") },
      { agent: "Allocation Planner", title: "Capped the allocatable vaults", body: legs.length ? legs.map((l) => `${l.vaultName}: up to the policy cap and the on-chain deposit limit`).join("; ") : "No vault to cap." },
      { agent: "SERV reasoning", title: "Decided per vault", body: `${i.decisionRationale ?? ""} Allocating ${legText} keeps ${after.liquidPct}% liquid. Health score ${before.healthScore} → ${after.healthScore}.` },
    ],
    memo: localMemo(i),
    confidence,
    source: "local",
  };
}

interface OpenServJson {
  title?: string;
  headline?: string;
  summary?: string;
  reasons?: { title: string; body: string }[];
  steps?: { agent: string; title: string; body: string }[];
  memo?: { title?: string; sections?: { heading: string; body: string }[] };
  confidence?: number;
}

function buildTask(input: NarrativeInput) {
  const facts = {
    policy: { riskProfile: input.user.riskProfile, liquidityFloorPct: input.user.liquidityFloorPct, maxAssetExposurePct: input.user.maxAssetExposurePct, minVaultRiskScore: input.user.minVaultRiskScore, monthlyBurnUsd: input.user.monthlyBurnUsd, treasuryGoal: input.user.treasuryGoal },
    treasury: { totalUsd: input.snapshot.totalUsd, idleUsd: input.snapshot.idleUsd, idlePct: input.snapshot.idlePct, idleDays: input.snapshot.idleDays, executionMode: input.snapshot.executionMode, assets: input.snapshot.assets.map((a) => ({ symbol: a.symbol, valueUsd: a.valueUsd, idleAmount: a.idleAmount, deployedIn: a.deployedIn })), positions: input.snapshot.positions, maxExposure: input.snapshot.maxExposure },
    candidates: input.assessments.map((a) => ({ strategyId: a.candidate.strategy.id, vault: a.candidate.strategy.vaultName, chain: a.candidate.strategy.chainName, asset: a.candidate.asset, yieldTtmPct: a.candidate.strategy.apy, riskScore: a.candidate.strategy.riskScore, settlement: a.candidate.strategy.settlement, preflight: a.preflight ? a.preflight.checks.map((c) => ({ label: c.label, ok: c.ok, severity: c.severity, value: c.value })) : "no vault deployed" })),
    decisions: input.decisions,
    plan: { rationale: input.decisionRationale, legs: input.legs.map((l) => ({ vault: l.vaultName, chain: l.chainName, amount: l.amount, asset: l.asset, amountUsd: l.amountUsd, apy: l.apy, settlement: vaultOf(input, l.strategyId)?.settlement })), before: input.before, after: input.after, extraMonthlyUsd: input.extraMonthlyUsd, totalUsd: input.totalUsd },
    deferred: input.deferred,
    rejected: input.rejected,
    policyChecks: input.policyChecks,
    nextCutoff: { sgt: input.cutoff.nextCutoffSgt, utc: input.cutoff.nextCutoffUtc, hoursUntil: input.cutoff.hoursUntilCutoff, estimatedSettlementSgt: input.cutoff.estimatedSettlementSgt, holidayAssumption: input.cutoff.holidayAssumption, source: input.cutoff.source },
    vaultTerms: { minDepositUsd: 100, depositFeePct: 0, redeemFeePct: 0.5, redemption: "request → awaiting RWA sale & operator finalization → paid (no claim step)", navUpdates: "periodic, off-chain NAV manager" },
    guardrails: { framing: "SERV decides; deterministic policy guardrails enforce hard limits", liveMaxPerTxUsdc: env.maxLiveTxUsdc, navStaleHours: env.navStaleHours },
  };
  const legList = input.legs.map((l) => `${fmtAmount(l.amount, l.asset)} (≈ ${fmtUsd(l.amountUsd)}) into ${l.vaultName} at ${l.apy}% TTM`).join("; ") || "none";
  const description = `Write the Vaulto allocation explanation and the investment-committee memo for the treasury manager. The verdicts have been decided by SERV reasoning and validated by the Allocation Planner (${input.legs.length} leg(s): ${legList}; total ${fmtUsd(input.totalUsd)}; liquidity ${input.before.liquidPct}% → ${input.after.liquidPct}%; blended yield ${input.before.blendedApy.toFixed(1)}% → ${input.after.blendedApy.toFixed(1)}%; health ${input.before.healthScore} → ${input.after.healthScore}; extra income ≈ ${fmtUsd(input.extraMonthlyUsd)} per month). Use only the numbers in the facts. Do not call tools. Reply with ONLY the JSON object described in the expected output.`;
  const body = `${VAULTO_SYSTEM_PROMPT}\n\nPIPELINE FACTS (JSON):\n${JSON.stringify(facts)}\n\nRULES: the headline and summary MUST mention every allocated leg with its amount, vault and chain; mention every deferred vault as "temporarily paused — waiting NAV refresh" with its facts and every rejected vault with its reason; never write "deposited" for an async request that has not settled (say "request submitted, pending operator settlement"); never invent figures; steps follow the pipeline order Treasury Scanner → Risk Guardian (pre-flight) → Allocation Planner (caps) → SERV reasoning (verdicts).`;
  const expectedOutput = `A single JSON object: {"title": string (≤6 words, a proposal name; never claim it is approved or executed), "headline": string (one sentence naming every leg, amount, vault and chain), "summary": string (2-3 sentences), "reasons": [{"title": string ending with a period, "body": string}] (exactly 3: capital efficiency, liquidity, verdicts), "steps": [{"agent": string, "title": string, "body": string}] (exactly 4), "memo": {"title": string, "sections": [{"heading": string, "body": string}]} with exactly these headings in order: "Treasury condition", "Policy", "Proposed allocation", "Deferred (waiting NAV refresh)", "Rejected", "Risks" (RWA credit risk, daily redemption cycle, 0.5% redemption fee, NAV drift between updates, smart-contract and counterparty risk), "Execution" (mode, cutoff and settlement estimate for async legs, that Live mode requires the wallet's signature and is capped per transaction by the guardrail), "confidence": number 0-100}. No prose outside the JSON.`;
  return { description, body, expectedOutput, facts };
}

/**
 * SERV reasoning, step 2 — writes the explanation and the memo a treasury manager reads, from the validated plan.
 * Inference mode calls the OpenServ Inference API; platform mode creates a workspace task.
 */
export async function narrate(input: NarrativeInput): Promise<Narrative> {
  const fallback = localNarrative(input);
  if (!openservConfigured()) return fallback;
  const task = buildTask(input);
  const started = Date.now();
  try {
    let output: string;
    let model: string;
    if (env.openservReasoningMode === "platform") {
      const r = await runOpenServTask(task);
      output = r.output;
      model = `OpenServ runtime · task #${r.taskId}`;
    } else {
      const r = await chatCompletion({
        messages: [
          { role: "system", content: VAULTO_SYSTEM_PROMPT },
          { role: "user", content: `${task.description}\n\n${task.body}\n\nEXPECTED OUTPUT: ${task.expectedOutput}` },
        ],
        maxTokens: 6000,
      });
      output = r.content;
      model = r.model;
    }
    const json = extractJson<OpenServJson>(output);
    recordEvidence({ kind: "serv", label: `SERV reasoning · narrative + memo (${model})`, request: { model, facts: task.facts }, response: json ?? output, ok: Boolean(json?.reasons?.length), durationMs: Date.now() - started });
    if (!json || !json.reasons?.length || !json.steps?.length) {
      console.warn("[openserv] unparseable reasoning output; using local narrative");
      return fallback;
    }
    const memo: Memo = json.memo?.sections?.length ? { title: json.memo.title ?? fallback.memo.title, sections: json.memo.sections.slice(0, 8) } : fallback.memo;
    return {
      title: json.title ?? fallback.title,
      headline: json.headline ?? fallback.headline,
      summary: json.summary ?? fallback.summary,
      reasons: json.reasons.slice(0, 3),
      steps: json.steps.slice(0, 4),
      memo,
      confidence: Math.round(Math.min(99, Math.max(50, json.confidence ?? fallback.confidence))),
      source: "openserv",
      model,
      input: task.facts,
      output: json,
    };
  } catch (e) {
    console.warn("[openserv] falling back to local reasoning:", e instanceof Error ? e.message : e);
    recordEvidence({ kind: "serv", label: "SERV reasoning · narrative + memo", request: { facts: task.facts }, response: { error: e instanceof Error ? e.message : String(e) }, ok: false, durationMs: Date.now() - started });
    return fallback;
  }
}

/** Display helper: chain short name for a leg. */
export const chainShort = (chainId: number) => chainInfo(chainId).short;
