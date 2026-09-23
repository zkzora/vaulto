import { CHAIN_NAME } from "@/lib/chain/config";
import { env, openservConfigured } from "@/lib/env";
import { fmtAmount, fmtUsd } from "@/lib/format";
import type { AllocationLeg, Metrics, RejectedOption, TreasurySnapshot, UserProfile } from "@/lib/types";
import type { Candidate } from "@/lib/agents/finder";
import { chatCompletion } from "./inference";
import { runOpenServTask } from "./platform";

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

export const VAULTO_SYSTEM_PROMPT = `You are Vaulto, an AI treasury allocation agent running on OpenServ.
You coordinate six agents: Treasury Scanner, Opportunity Finder, Risk Guardian, Allocation Planner, Execution and Monitoring.
You reason about DAO / Web3 company treasuries and recommend IXS RWA vault strategies.
Rules: never execute or move funds; only explain and recommend. Never propose selling assets to chase yield.
Respect the user's liquidity floor, asset exposure limit and minimum vault risk score.
Write in plain, confident language for a treasury manager. Be specific with numbers.`;

/** Deterministic narrative used when the OpenServ platform is not configured (or as fallback). */
export function localNarrative(i: NarrativeInput): Narrative {
  const { snapshot, user, legs, before, after, candidates, rejected } = i;
  const legText = legs.map((l) => `${fmtAmount(l.amount, l.asset)} into ${l.vaultName} (${l.apy.toFixed(1)}%)`).join(" and ");
  const idleText = snapshot.assets
    .filter((a) => a.idle)
    .map((a) => fmtAmount(a.idleAmount, a.symbol))
    .join(" and ");
  const scores = legs.map((l) => l.riskScore);
  const passesAll = i.policyChecks.every((c) => c.ok);
  const confidence = Math.min(97, Math.max(70, Math.round(80 + (passesAll ? 8 : -6) + Math.min(scores.length ? Math.min(...scores) : 80, 100) * 0.06 - (snapshot.onchain.rpcOk ? 0 : 3))));
  const onchainLegs = legs.filter((l) => l.onchainAmount > 0);

  return {
    title: "Allocate idle treasury capital",
    headline: `Allocate ${fmtUsd(i.totalUsd)} into IXS RWA vaults and keep a ${after.liquidPct}% liquidity reserve`,
    summary: `Your treasury has ${fmtUsd(snapshot.idleUsd)} idle (${snapshot.idlePct}%). Based on your ${user.liquidityFloorPct}% liquidity floor and ${user.riskProfile.toLowerCase()} risk policy, Vaulto recommends ${legText}. Liquidity stays at ${after.liquidPct}% and blended yield moves from ${before.blendedApy.toFixed(1)}% to ${after.blendedApy.toFixed(1)}%.`,
    reasons: [
      {
        title: "Improves capital efficiency.",
        body: `${idleText} (≈ ${fmtUsd(snapshot.idleUsd)}) have sat idle for ${snapshot.idleDays} days earning nothing. Deploying ${fmtUsd(i.totalUsd)} adds about ${fmtUsd(i.extraMonthlyUsd)} per month.`,
      },
      {
        title: "Maintains required liquidity.",
        body: `Treasury stays ${after.liquidPct}% liquid, above your ${user.liquidityFloorPct}% floor${user.monthlyBurnUsd > 0 ? `, covering ${Math.round((snapshot.idleUsd - i.totalUsd) / user.monthlyBurnUsd)}+ months of burn` : ""}. ${legs.length > 1 ? "Both vaults" : "The vault"} withdraw${legs.length > 1 ? "" : "s"} within 24 hours.`,
      },
      {
        title: "Matches treasury objectives.",
        body: legs.map((l) => (l.asset === "BTC" ? `BTC stays BTC in ${l.vaultName} (${l.apy}%)` : `${l.asset} runway earns ${l.apy}% in ${l.vaultName}`)).join("; ") + ". No asset is sold.",
      },
    ],
    steps: [
      {
        agent: "Treasury Scanner + Opportunity Finder",
        title: "Detected idle capital",
        body: `${snapshot.idlePct}% of capital is idle: ${idleText}. ${snapshot.positions.length} existing IXS position${snapshot.positions.length === 1 ? "" : "s"} and vault data read through IXS Vault API / MCP${snapshot.onchain.rpcOk ? ` and ${CHAIN_NAME} (block ${snapshot.onchain.blockNumber})` : ""}.`,
      },
      {
        agent: "Risk Guardian",
        title: "Evaluated allocation against policy",
        body: `${candidates.map((c) => `${c.strategy.vaultName} scores ${c.strategy.riskScore}`).join(", ")}. ${legs.length ? `Selected vaults pass your ≥ ${user.minVaultRiskScore} threshold` : "No vault passed"}; exposure ${snapshot.maxExposure.symbol} ${snapshot.maxExposure.pct}% stays under the ${user.maxAssetExposurePct}% limit.`,
      },
      {
        agent: "Allocation Planner",
        title: "Compared IXS strategies",
        body: `${legs.map((l) => `${l.vaultName} ${l.apy}% for idle ${l.asset}`).join("; ")}. ${rejected
          .filter((r) => r.tone === "warn")
          .slice(0, 2)
          .map((r) => `${r.option.split(" · ")[0]}: ${r.reason.toLowerCase()}`)
          .join("; ")}.`,
      },
      {
        agent: "Allocation Planner",
        title: "Sized to your liquidity floor",
        body: `Allocating ${legs.map((l) => fmtAmount(l.amount, l.asset)).join(" and ")} (≈ ${fmtUsd(i.totalUsd)}) keeps ${after.liquidPct}% liquid${user.monthlyBurnUsd > 0 ? ": two months of burn plus buffer" : " above the policy floor"}. Health score ${before.healthScore} → ${after.healthScore}.${onchainLegs.length ? ` ${onchainLegs.map((l) => `${fmtAmount(l.onchainAmount, l.asset)} executes on-chain on ${CHAIN_NAME}`).join("; ")}.` : ""}`,
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

function extractJson(text: string): OpenServJson | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as OpenServJson;
  } catch {
    return null;
  }
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
      totalUsd: input.snapshot.totalUsd,
      idleUsd: input.snapshot.idleUsd,
      idlePct: input.snapshot.idlePct,
      idleDays: input.snapshot.idleDays,
      assets: input.snapshot.assets.map((a) => ({ symbol: a.symbol, valueUsd: a.valueUsd, idleAmount: a.idleAmount, deployedIn: a.deployedIn })),
      positions: input.snapshot.positions,
      maxExposure: input.snapshot.maxExposure,
      chain: CHAIN_NAME,
    },
    candidates: input.candidates.map((c) => ({ vault: c.strategy.vaultName, asset: c.asset, apy: c.strategy.apy, riskScore: c.strategy.riskScore, liquidity: c.strategy.liquidity, notes: c.notes })),
    plan: { legs: input.legs, before: input.before, after: input.after, extraMonthlyUsd: input.extraMonthlyUsd, totalUsd: input.totalUsd },
    rejected: input.rejected,
    policyChecks: input.policyChecks,
  };
  const legList = input.legs.map((l) => `${fmtAmount(l.amount, l.asset)} (≈ ${fmtUsd(l.amountUsd)}) into ${l.vaultName} at ${l.apy}% APY`).join("; ");
  const description = `Write the Vaulto treasury allocation explanation for the treasury manager. The Allocation Planner has already decided the plan (${input.legs.length} leg(s): ${legList}; total ${fmtUsd(input.totalUsd)}; liquidity ${input.before.liquidPct}% → ${input.after.liquidPct}%; blended APY ${input.before.blendedApy.toFixed(1)}% → ${input.after.blendedApy.toFixed(1)}%; health ${input.before.healthScore} → ${input.after.healthScore}; extra income ≈ ${fmtUsd(input.extraMonthlyUsd)} per month). Use only the numbers in the task body. Do not call tools. Reply with ONLY the JSON object described in the expected output.`;
  const body = `${VAULTO_SYSTEM_PROMPT}\n\nPIPELINE FACTS (JSON):\n${JSON.stringify(facts)}\n\nRULES: the headline and summary MUST mention every leg with its amount and vault name; never invent figures; mention the liquidity floor and what was rejected; steps follow the pipeline order Treasury Scanner → Risk Guardian → Allocation Planner (compare) → Allocation Planner (size).`;
  const expectedOutput = `A single JSON object: {"title": string (≤6 words), "headline": string (one sentence naming every leg, amount and vault), "summary": string (2-3 sentences), "reasons": [{"title": string ending with a period, "body": string}] (exactly 3: capital efficiency, liquidity, objectives), "steps": [{"agent": string, "title": string, "body": string}] (exactly 4), "confidence": number 0-100}. No prose outside the JSON.`;
  return { description, body, expectedOutput };
}

/**
 * OpenServ reasoning.
 *  - inference mode (default): the pipeline facts go to the OpenServ Inference API (OpenAI-compatible
 *    endpoint hosted by OpenServ, authenticated with the serv_… key) which writes the explanation.
 *  - platform mode: the facts become a task for the Vaulto agent in an OpenServ workspace; the
 *    OpenServ runtime completes it with its own model.
 * Falls back to the local narrative if OpenServ is not configured or the call fails.
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
          { role: "user", content: `${task.description}

${task.body}

EXPECTED OUTPUT: ${task.expectedOutput}` },
        ],
      });
      output = r.content;
      model = r.model;
    }
    const json = extractJson(output);
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
