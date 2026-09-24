import { CHAIN_NAME } from "@/lib/chain/config";
import { env, openservConfigured } from "@/lib/env";
import { fmtAmount, fmtUsd, vaultLabel } from "@/lib/format";
import type { AllocationLeg, Metrics, RejectedOption, TreasurySnapshot, UserProfile } from "@/lib/types";
import type { Candidate } from "@/lib/agents/finder";
import type { Constraints, LegInput } from "@/lib/agents/planner";
import { chatCompletion } from "./inference";
import { runOpenServTask } from "./platform";

export const VAULTO_SYSTEM_PROMPT = `You are Vaulto, an AI treasury allocation agent running on OpenServ (SERV reasoning).
You coordinate six agents: Treasury Scanner, Opportunity Finder, Risk Guardian, Allocation Planner, Execution and Monitoring.
You reason about DAO / Web3 company treasuries and allocate idle capital into IXS Finance RWA vaults.
Rules: never execute or move funds; only decide, explain and recommend. Never propose selling assets to chase yield.
Only allocate into vaults that are live on the IXS Vault API; if a product is announced but not deployed (e.g. BTC Real Yield),
say so explicitly, reject that allocation, and offer the best available alternative (a USDC portion into the live IXS vault).
Respect the liquidity floor, asset exposure limit, minimum vault risk score and the stablecoin runway reserve.
The IXS vaults require a minimum deposit of 100 USDC per allocation: never propose a smaller leg.
Deposits run as "Simulated on BNB mainnet" (eth_call + state override against the real vault) until the wallet holds 100 USDC, then they are signed live; the allocation logic is identical in both modes.
Write in plain, confident language for a treasury manager. Be specific with numbers and never invent figures.`;

/* ------------------------------------------------------------------ decision ------------------------------------------------------------------ */

export interface DecisionInput {
  user: UserProfile;
  snapshot: TreasurySnapshot;
  candidates: Candidate[];
  rejected: RejectedOption[];
  constraints: Constraints;
  policyChecks: { label: string; ok: boolean; detail: string }[];
  /** Deterministic fallback sizing, also shown to SERV as a reference. */
  fallback: LegInput[];
}

export interface Decision {
  legs: LegInput[];
  rationale: string;
  source: "openserv" | "local";
  model?: string;
}

function decisionFacts(i: DecisionInput) {
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
      chain: CHAIN_NAME,
      totalUsd: i.snapshot.totalUsd,
      idleUsd: i.snapshot.idleUsd,
      idlePct: i.snapshot.idlePct,
      idleDays: i.snapshot.idleDays,
      assets: i.snapshot.assets.map((a) => ({ symbol: a.symbol, valueUsd: a.valueUsd, idleAmount: a.idleAmount, idleUsd: a.idleUsd, deployedIn: a.deployedIn })),
      positions: i.snapshot.positions.map((p) => ({ vault: p.vaultName, asset: p.asset, valueUsd: p.valueUsd, apy: p.apy })),
      maxExposure: i.snapshot.maxExposure,
    },
    candidates: i.candidates.map((c) => ({
      strategyId: c.strategy.id,
      vault: c.strategy.vaultName,
      asset: c.asset,
      apy: c.strategy.apy,
      apyEstimated: c.strategy.apyEstimated ?? false,
      riskScore: c.strategy.riskScore,
      liquidity: c.strategy.liquidity,
      available: c.available,
      status: c.strategy.status,
      requiresWhitelist: c.strategy.requiresWhitelist,
      notes: c.notes,
    })),
    rejectedByRiskGuardian: i.rejected,
    policyChecks: i.policyChecks,
    constraints: {
      budgetUsd: i.constraints.budgetUsd,
      keepLiquidUsd: i.constraints.keepLiquidUsd,
      stableReserveUsd: i.constraints.stableReserveUsd,
      minDepositUsd: i.constraints.minDepositUsd,
      caps: i.constraints.caps.map((c) => ({ strategyId: c.strategyId, vault: c.vaultName, asset: c.asset, maxAmount: c.maxAmount, maxUsd: c.maxUsd, priceUsd: c.priceUsd, apy: c.apy, note: c.capNote })),
    },
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

/**
 * SERV reasoning, step 1 — decides the allocation. The Risk Guardian has already filtered candidates and
 * the Planner has computed hard caps; SERV chooses the legs (it may allocate less than the caps) and
 * states why. Falls back to the deterministic sizing when OpenServ is not configured or fails.
 */
export async function decideAllocation(input: DecisionInput): Promise<Decision> {
  const fallback: Decision = { legs: input.fallback, rationale: "Deterministic sizing (SERV reasoning unavailable).", source: "local" };
  if (!openservConfigured() || env.openservReasoningMode === "platform") return fallback;
  try {
    const prompt = `DECIDE THE ALLOCATION for this treasury. Facts (JSON):\n${JSON.stringify(decisionFacts(input))}\n\nRules: choose amounts only for strategyIds listed in constraints.caps and never above their maxAmount and never below constraints.minDepositUsd in USD; the sum in USD must not exceed constraints.budgetUsd; you may allocate less if prudence requires it (explain why). If a candidate has available=false (announced, not deployed), do not allocate to it and mention it in the rationale, offering the USDC portion into the live IXS vault instead. Respond with ONLY JSON: {"legs":[{"strategyId":string,"amount":number}],"rationale":string (2-3 sentences)}`;
    const r = await chatCompletion({ messages: [{ role: "system", content: VAULTO_SYSTEM_PROMPT }, { role: "user", content: prompt }], temperature: 0.1 });
    const json = extractJson<{ legs?: { strategyId: string; amount: number }[]; rationale?: string }>(r.content);
    if (!json?.legs) return fallback;
    const legs = json.legs.filter((l) => typeof l.strategyId === "string" && typeof l.amount === "number" && l.amount > 0);
    return { legs, rationale: json.rationale ?? "", source: "openserv", model: r.model };
  } catch (e) {
    console.warn("[openserv] decision fell back to local sizing:", e instanceof Error ? e.message : e);
    return fallback;
  }
}

/* ------------------------------------------------------------------ narrative ------------------------------------------------------------------ */

export interface NarrativeInput {
  user: UserProfile;
  snapshot: TreasurySnapshot;
  candidates: Candidate[];
  legs: AllocationLeg[];
  before: Metrics;
  after: Metrics;
  rejected: RejectedOption[];
  extraMonthlyUsd: number;
  totalUsd: number;
  policyChecks: { label: string; ok: boolean; detail: string }[];
  decisionRationale?: string;
}

export interface Narrative {
  title: string;
  headline: string;
  summary: string;
  reasons: { title: string; body: string }[];
  steps: { agent: string; title: string; body: string }[];
  confidence: number;
  source: "openserv" | "local";
  model?: string;
}

/** Deterministic narrative used when OpenServ is not configured (or as fallback). */
export function localNarrative(i: NarrativeInput): Narrative {
  const { snapshot, user, legs, before, after, candidates, rejected } = i;
  const legText = legs.map((l) => `${fmtAmount(l.amount, l.asset)} into ${l.vaultName} (${l.apy.toFixed(1)}%)`).join(" and ");
  const idleText = snapshot.assets
    .filter((a) => a.idle)
    .map((a) => fmtAmount(a.idleAmount, a.symbol))
    .join(" and ");
  const unavailable = candidates.filter((c) => !c.available);
  const scores = legs.map((l) => l.riskScore);
  const passesAll = i.policyChecks.every((c) => c.ok);
  const confidence = Math.min(97, Math.max(70, Math.round(80 + (passesAll ? 8 : -6) + Math.min(scores.length ? Math.min(...scores) : 80, 100) * 0.06 - (snapshot.onchain.rpcOk ? 0 : 3))));
  const onchainLegs = legs.filter((l) => l.onchainAmount > 0);

  return {
    title: "Allocate idle treasury capital",
    headline: `Allocate ${fmtUsd(i.totalUsd)} into IXS vaults and keep a ${after.liquidPct}% liquidity reserve`,
    summary: `Your treasury has ${fmtUsd(snapshot.idleUsd)} idle (${snapshot.idlePct}%). Based on your ${user.liquidityFloorPct}% liquidity floor and ${user.riskProfile.toLowerCase()} risk policy, Vaulto recommends ${legText}.${unavailable.length ? ` ${unavailable.map((c) => `${c.strategy.vaultName} is announced by IXS but not deployed, so idle ${c.asset} stays put`).join("; ")}.` : ""} Liquidity stays at ${after.liquidPct}% and blended yield moves from ${before.blendedApy.toFixed(1)}% to ${after.blendedApy.toFixed(1)}%.`,
    reasons: [
      {
        title: "Improves capital efficiency.",
        body: `${idleText} (≈ ${fmtUsd(snapshot.idleUsd)}) have sat idle for ${snapshot.idleDays} days earning nothing. Deploying ${fmtUsd(i.totalUsd)} adds about ${fmtUsd(i.extraMonthlyUsd)} per month.`,
      },
      {
        title: "Maintains required liquidity.",
        body: `Treasury stays ${after.liquidPct}% liquid, above your ${user.liquidityFloorPct}% floor${user.monthlyBurnUsd > 0 ? `, and two months of burn stay in stablecoins` : ""}. ${legs.length > 1 ? "All vaults" : "The vault"} settle${legs.length > 1 ? "" : "s"} daily.`,
      },
      {
        title: "Matches treasury objectives.",
        body: `${legs.map((l) => `${l.asset} runway earns ${l.apy}% in ${l.vaultName}`).join("; ")}. No asset is sold.${unavailable.length ? ` ${unavailable.map((c) => `${c.asset} waits for the ${vaultLabel(c.strategy.vaultName)} vault to go live`).join("; ")}.` : ""}`,
      },
    ],
    steps: [
      {
        agent: "Treasury Scanner + Opportunity Finder",
        title: "Detected idle capital",
        body: `${snapshot.idlePct}% of capital is idle: ${idleText}. ${snapshot.positions.length} existing IXS position${snapshot.positions.length === 1 ? "" : "s"} and vault data read through the IXS Vault API / MCP${snapshot.onchain.rpcOk ? ` and ${CHAIN_NAME} (block ${snapshot.onchain.blockNumber})` : ""}.`,
      },
      {
        agent: "Risk Guardian",
        title: "Checked vault availability and policy",
        body: `${candidates.map((c) => `${c.strategy.vaultName}: ${c.available ? `live, score ${c.strategy.riskScore}` : "announced by IXS, no vault deployed (IXS Vault API)"}`).join("; ")}. ${legs.length ? `Selected vaults pass your ≥ ${user.minVaultRiskScore} threshold` : "No vault passed"}; exposure ${snapshot.maxExposure.symbol} ${snapshot.maxExposure.pct}% vs the ${user.maxAssetExposurePct}% limit.`,
      },
      {
        agent: "Allocation Planner",
        title: "Compared IXS strategies",
        body: `${legs.map((l) => `${l.vaultName} ${l.apy}% for idle ${l.asset}`).join("; ")}. ${rejected
          .filter((r) => r.tone === "warn")
          .slice(0, 3)
          .map((r) => `${r.option.split(" · ")[0]}: ${r.reason.toLowerCase()}`)
          .join("; ")}.`,
      },
      {
        agent: "SERV reasoning",
        title: "Sized the allocation",
        body: `${i.decisionRationale ? i.decisionRationale + " " : ""}Allocating ${legs.map((l) => fmtAmount(l.amount, l.asset)).join(" and ")} (≈ ${fmtUsd(i.totalUsd)}) keeps ${after.liquidPct}% liquid. Health score ${before.healthScore} → ${after.healthScore}.${onchainLegs.length ? ` ${onchainLegs.map((l) => `${fmtAmount(l.onchainAmount, l.asset)} executes on-chain on ${CHAIN_NAME} via IXS MCP`).join("; ")}.` : ""}`,
      },
    ],
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
  confidence?: number;
}

function buildTask(input: NarrativeInput) {
  const facts = {
    policy: {
      riskProfile: input.user.riskProfile,
      liquidityFloorPct: input.user.liquidityFloorPct,
      maxAssetExposurePct: input.user.maxAssetExposurePct,
      minVaultRiskScore: input.user.minVaultRiskScore,
      monthlyBurnUsd: input.user.monthlyBurnUsd,
      treasuryGoal: input.user.treasuryGoal,
    },
    treasury: {
      chain: CHAIN_NAME,
      totalUsd: input.snapshot.totalUsd,
      idleUsd: input.snapshot.idleUsd,
      idlePct: input.snapshot.idlePct,
      idleDays: input.snapshot.idleDays,
      assets: input.snapshot.assets.map((a) => ({ symbol: a.symbol, valueUsd: a.valueUsd, idleAmount: a.idleAmount, deployedIn: a.deployedIn })),
      positions: input.snapshot.positions,
      maxExposure: input.snapshot.maxExposure,
    },
    candidates: input.candidates.map((c) => ({ vault: c.strategy.vaultName, asset: c.asset, apy: c.strategy.apy, apyEstimated: c.strategy.apyEstimated ?? false, riskScore: c.strategy.riskScore, liquidity: c.strategy.liquidity, available: c.available, notes: c.notes })),
    decision: { rationale: input.decisionRationale, legs: input.legs, before: input.before, after: input.after, extraMonthlyUsd: input.extraMonthlyUsd, totalUsd: input.totalUsd },
    rejected: input.rejected,
    policyChecks: input.policyChecks,
  };
  const legList = input.legs.map((l) => `${fmtAmount(l.amount, l.asset)} (≈ ${fmtUsd(l.amountUsd)}) into ${l.vaultName} at ${l.apy}% APY`).join("; ");
  const unavailable = input.candidates.filter((c) => !c.available).map((c) => `${c.strategy.vaultName} for idle ${fmtAmount(c.idleAmount, c.asset)}`);
  const description = `Write the Vaulto treasury allocation explanation for the treasury manager. The allocation has been decided by SERV reasoning and validated by the Allocation Planner (${input.legs.length} leg(s): ${legList}; total ${fmtUsd(input.totalUsd)}; liquidity ${input.before.liquidPct}% → ${input.after.liquidPct}%; blended APY ${input.before.blendedApy.toFixed(1)}% → ${input.after.blendedApy.toFixed(1)}%; health ${input.before.healthScore} → ${input.after.healthScore}; extra income ≈ ${fmtUsd(input.extraMonthlyUsd)} per month).${unavailable.length ? ` Not allocated because IXS announced but has not deployed the vault (checked live on the IXS Vault API): ${unavailable.join("; ")}. Explain this and that the USDC portion goes to the live IXS vault instead.` : ""} Use only the numbers in the task body. Do not call tools. Reply with ONLY the JSON object described in the expected output.`;
  const body = `${VAULTO_SYSTEM_PROMPT}\n\nPIPELINE FACTS (JSON):\n${JSON.stringify(facts)}\n\nRULES: the headline and summary MUST mention every leg with its amount and vault name; never invent figures; mention the liquidity floor, what was rejected and any announced-but-undeployed IXS vault; steps follow the pipeline order Treasury Scanner → Risk Guardian → Allocation Planner (compare) → SERV reasoning (size).`;
  const expectedOutput = `A single JSON object: {"title": string (≤6 words, a proposal name; never claim it is approved or executed), "headline": string (one sentence naming every leg, amount and vault), "summary": string (2-3 sentences), "reasons": [{"title": string ending with a period, "body": string}] (exactly 3: capital efficiency, liquidity, objectives), "steps": [{"agent": string, "title": string, "body": string}] (exactly 4), "confidence": number 0-100}. No prose outside the JSON.`;
  return { description, body, expectedOutput };
}

/**
 * SERV reasoning, step 2 — writes the explanation a treasury manager reads, from the validated plan.
 * Inference mode calls the OpenServ Inference API; platform mode creates a workspace task.
 */
export async function narrate(input: NarrativeInput): Promise<Narrative> {
  const fallback = localNarrative(input);
  if (!openservConfigured()) return fallback;
  const task = buildTask(input);
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
      });
      output = r.content;
      model = r.model;
    }
    const json = extractJson<OpenServJson>(output);
    if (!json || !json.reasons?.length || !json.steps?.length) {
      console.warn("[openserv] unparseable reasoning output; using local narrative");
      return fallback;
    }
    return {
      title: json.title ?? fallback.title,
      headline: json.headline ?? fallback.headline,
      summary: json.summary ?? fallback.summary,
      reasons: json.reasons.slice(0, 3),
      steps: json.steps.slice(0, 4),
      confidence: Math.round(Math.min(99, Math.max(50, json.confidence ?? fallback.confidence))),
      source: "openserv",
      model,
    };
  } catch (e) {
    console.warn("[openserv] falling back to local reasoning:", e instanceof Error ? e.message : e);
    return fallback;
  }
}
