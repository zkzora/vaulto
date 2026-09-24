import { randomUUID } from "node:crypto";
import { invalidateOnchain, readOnchainTreasury } from "@/lib/chain/treasury";
import { EXPLORER, publicClient } from "@/lib/chain/client";
import { CHAIN_NAME, LIVE_MODE_MIN_USDC, MODE_LABEL } from "@/lib/chain/config";
import { getStore, normalizeAddress } from "@/lib/db";
import { fmtAmount, fmtUsd } from "@/lib/format";
import { checkWhitelist, getStrategies, vaultAvailability } from "@/lib/ixs/client";
import { getBtcVolatility30d, getPrices } from "@/lib/prices";
import { scanTreasury } from "@/lib/agents/scanner";
import { findOpportunities } from "@/lib/agents/finder";
import { guardCandidates } from "@/lib/agents/risk";
import { buildPlan, localLegs, planConstraints } from "@/lib/agents/planner";
import { prepareTransaction } from "@/lib/agents/execution";
import { buildPortfolioReport, buildRiskReport } from "@/lib/agents/monitoring";
import { decideAllocation, narrate } from "@/lib/openserv/reasoning";
import type {
  AgentLog,
  AnalysisResult,
  PreparedTransaction,
  Recommendation,
  RecommendationStatus,
  TransactionRecord,
  TreasurySnapshot,
  TxStatus,
  UserPatch,
  UserProfile,
  VaultStrategy,
} from "@/lib/types";

/**
 * Agent Orchestrator — coordinates the multi-agent pipeline, the IXS adapter, SERV (OpenServ)
 * reasoning and persistence. Every API route delegates here.
 */

export async function getUser(address: string) {
  return (await getStore()).getOrCreateUser(address);
}

export async function updateUser(address: string, patch: UserPatch) {
  return (await getStore()).updateUser(address, patch);
}

export async function resetUser(address: string) {
  return (await getStore()).resetUser(address);
}

export async function loadStrategies() {
  const result = await getStrategies();
  const store = await getStore();
  store.upsertStrategies(result.strategies).catch(() => undefined);
  return result;
}

export interface ScanResult {
  user: UserProfile;
  snapshot: TreasurySnapshot;
  strategies: VaultStrategy[];
  liveOk: boolean;
}

export async function scan(address: string): Promise<ScanResult> {
  const store = await getStore();
  const [user, demoState, onchain, prices, { strategies, liveOk }] = await Promise.all([
    store.getOrCreateUser(address),
    store.getDemoState(address),
    readOnchainTreasury(address),
    getPrices(),
    loadStrategies(),
  ]);
  const snapshot = scanTreasury({ user, onchain, prices, strategies, demoState });
  store.saveTreasurySnapshot(address, snapshot.assets).catch(() => undefined);
  return { user, snapshot, strategies, liveOk };
}

const log = async (entry: Omit<AgentLog, "id" | "createdAt">) => (await getStore()).addLog(entry);

function emptyMetrics(snapshot: TreasurySnapshot) {
  return { liquidPct: snapshot.liquidPct, blendedApy: snapshot.blendedApy, healthScore: snapshot.healthScore, idlePct: snapshot.idlePct, allocatedPct: snapshot.allocatedPct, perStrategyPct: {} };
}

export async function analyze(address: string): Promise<AnalysisResult> {
  const started = Date.now();
  const store = await getStore();
  const wallet = normalizeAddress(address);
  const { user, snapshot, strategies } = await scan(wallet);
  const logs: AgentLog[] = [];

  logs.push(
    await log({
      walletAddress: wallet,
      agentName: "Treasury Scanner Agent",
      action: "scan",
      reasoning: `Scanned ${snapshot.assets.length} assets, ${snapshot.positions.length} IXS positions${snapshot.onchain.rpcOk ? ` (${CHAIN_NAME} block ${snapshot.onchain.blockNumber})` : ""}. ${snapshot.idlePct}% of capital idle.`,
      status: "info",
      source: "OpenServ",
    }),
  );

  const candidates = findOpportunities(snapshot, strategies, user);
  logs.push(
    await log({
      walletAddress: wallet,
      agentName: "Opportunity Finder Agent",
      action: "find",
      reasoning: `${fmtUsd(snapshot.idleUsd, { compact: true })} inefficient capital, opportunity score ${snapshot.opportunityScore}. ${candidates.length} IXS strategies match idle assets${candidates.some((c) => !c.available) ? ` (${candidates.filter((c) => !c.available).map((c) => c.strategy.vaultName).join(", ")} announced but not deployed)` : ""}.`,
      status: "info",
      source: "OpenServ",
    }),
  );

  // Live checks through IXS: vault availability (Vault API) and eligibility (MCP vault_check_whitelist).
  const [availability, whitelistEntries] = await Promise.all([
    vaultAvailability(candidates.map((c) => c.strategy)),
    Promise.all(
      candidates
        .filter((c) => c.strategy.requiresWhitelist && c.strategy.routeId)
        .map(async (c) => [c.strategy.id, await checkWhitelist(c.strategy.routeId!, wallet)] as const),
    ),
  ]);
  const whitelist = Object.fromEntries(whitelistEntries) as Record<string, boolean | null>;

  const verdict = guardCandidates(candidates, snapshot, user, whitelist, availability);
  const constraints = planConstraints(snapshot, verdict.approved, user);
  logs.push(
    await log({
      walletAddress: wallet,
      agentName: "Risk Guardian Agent",
      action: "evaluate",
      reasoning: constraints
        ? `Validated policy. Budget ${fmtUsd(constraints.budgetUsd)} with ${fmtUsd(constraints.keepLiquidUsd)} kept liquid${constraints.stableReserveUsd ? ` and ${fmtUsd(constraints.stableReserveUsd)} stablecoin runway reserved` : ""}. ${verdict.rejected.filter((r) => r.tone === "warn").length} options rejected${Object.values(availability).some((a) => !a.available) ? `; ${Object.values(availability).filter((a) => !a.available).map((a) => a.detail).join("; ")}` : ""}.`
        : `No allocation passes policy right now (${verdict.policyChecks.map((c) => `${c.label}: ${c.ok ? "ok" : "fail"}`).join(", ")}).`,
      status: constraints ? "info" : "warn",
      source: "OpenServ",
    }),
  );

  if (!constraints) {
    const rec: Recommendation = {
      id: randomUUID(),
      walletAddress: wallet,
      title: "No allocation recommended",
      headline: verdict.approved.length ? "Treasury is already deployed within policy. Vaulto will keep monitoring." : "No live IXS vault matches the idle assets right now. Vaulto will keep monitoring.",
      foundLabel: `${fmtUsd(snapshot.idleUsd)} idle capital`,
      summary: verdict.approved.length
        ? "There is no idle capital above your liquidity floor to deploy safely. Nothing to approve."
        : `${verdict.rejected.map((r) => `${r.option}: ${r.reason}`).join("; ") || "Nothing to allocate."} Nothing to approve.`,
      legs: [],
      before: emptyMetrics(snapshot),
      after: emptyMetrics(snapshot),
      totalUsd: 0,
      extraMonthlyUsd: 0,
      confidence: 90,
      reasons: [{ title: "Policy respected.", body: verdict.policyChecks.map((c) => `${c.label}: ${c.detail}`).join(". ") }],
      steps: [],
      rejected: verdict.rejected,
      status: "dismissed",
      reasoningSource: "local",
      durationMs: Date.now() - started,
      createdAt: new Date().toISOString(),
      txCount: 0,
      feeUsd: 0,
      idleUsd: snapshot.idleUsd,
      context: { demoMode: snapshot.demoMode, totalUsd: snapshot.totalUsd },
    };
    await store.saveRecommendation(rec);
    return { snapshot, recommendation: rec, logs, user };
  }

  // SERV reasoning decides the allocation within the Planner's caps; the Planner validates it.
  const fallback = localLegs(constraints);
  const decision = await decideAllocation({ user, snapshot, candidates, rejected: verdict.rejected, constraints, policyChecks: verdict.policyChecks, fallback });
  let plan = buildPlan(snapshot, verdict.approved, user, constraints, decision.legs);
  let decisionSource = decision.source;
  if (!plan && decision.source === "openserv") {
    plan = buildPlan(snapshot, verdict.approved, user, constraints, fallback);
    decisionSource = "local";
  }
  logs.push(
    await log({
      walletAddress: wallet,
      agentName: "Allocation Planner Agent",
      action: "plan",
      reasoning: plan
        ? `${decisionSource === "openserv" ? `SERV reasoning (${decision.model ?? "OpenServ"}) decided` : "Deterministic sizing chose"} ${plan.legs.map((l) => `${fmtAmount(l.amount, l.asset)} → ${l.vaultName}`).join(", ")} within a ${fmtUsd(constraints.budgetUsd)} budget${decision.rationale ? `: ${decision.rationale}` : "."}`
        : "SERV reasoning declined to allocate within the current constraints.",
      status: plan ? "success" : "warn",
      source: "OpenServ",
    }),
  );

  if (!plan) {
    const rec: Recommendation = {
      id: randomUUID(),
      walletAddress: wallet,
      title: "No allocation recommended",
      headline: "SERV reasoning kept the treasury liquid for now.",
      foundLabel: `${fmtUsd(snapshot.idleUsd)} idle capital`,
      summary: decision.rationale || "The reasoning engine decided not to deploy capital under the current policy. Nothing to approve.",
      legs: [],
      before: emptyMetrics(snapshot),
      after: emptyMetrics(snapshot),
      totalUsd: 0,
      extraMonthlyUsd: 0,
      confidence: 85,
      reasons: [{ title: "Reasoning outcome.", body: decision.rationale || "No allocation within constraints." }],
      steps: [],
      rejected: verdict.rejected,
      status: "dismissed",
      reasoningSource: decision.source,
      reasoningModel: decision.model,
      durationMs: Date.now() - started,
      createdAt: new Date().toISOString(),
      txCount: 0,
      feeUsd: 0,
      idleUsd: snapshot.idleUsd,
      context: { demoMode: snapshot.demoMode, totalUsd: snapshot.totalUsd },
    };
    await store.saveRecommendation(rec);
    return { snapshot, recommendation: rec, logs, user };
  }

  const narrative = await narrate({
    user,
    snapshot,
    candidates,
    legs: plan.legs,
    before: plan.before,
    after: plan.after,
    rejected: verdict.rejected,
    extraMonthlyUsd: plan.extraMonthlyUsd,
    totalUsd: plan.totalUsd,
    policyChecks: verdict.policyChecks,
    decisionRationale: decision.rationale,
  });

  logs.push(
    await log({
      walletAddress: wallet,
      agentName: "SERV Reasoning",
      action: "explain",
      reasoning: `${fmtUsd(plan.totalUsd)} across ${plan.legs.map((l) => l.vaultName).join(" and ")}. Explanation by ${narrative.source === "openserv" ? `OpenServ (${narrative.model ?? "platform model"})` : "Vaulto local engine"}, confidence ${narrative.confidence}%.`,
      status: "success",
      source: "OpenServ",
    }),
  );

  const rec: Recommendation = {
    id: randomUUID(),
    walletAddress: wallet,
    title: narrative.title,
    headline: narrative.headline,
    foundLabel: `${fmtUsd(snapshot.idleUsd)} inefficient capital`,
    summary: narrative.summary,
    legs: plan.legs,
    before: plan.before,
    after: plan.after,
    totalUsd: plan.totalUsd,
    extraMonthlyUsd: plan.extraMonthlyUsd,
    confidence: narrative.confidence,
    reasons: narrative.reasons,
    steps: narrative.steps,
    rejected: verdict.rejected,
    status: "proposed",
    reasoningSource: decisionSource === "openserv" || narrative.source === "openserv" ? "openserv" : "local",
    reasoningModel: narrative.model ?? decision.model,
    durationMs: Date.now() - started,
    createdAt: new Date().toISOString(),
    txCount: plan.txCount,
    feeUsd: plan.feeUsd,
    idleUsd: snapshot.idleUsd,
    context: { demoMode: snapshot.demoMode, totalUsd: snapshot.totalUsd },
  };
  await store.saveRecommendation(rec);
  return { snapshot, recommendation: rec, logs, user };
}

export async function latestRecommendation(address: string) {
  return (await getStore()).getLatestRecommendation(address);
}

/**
 * Latest recommendation, expired automatically when it no longer matches the treasury it was
 * computed for (demo layer toggled, or idle / total capital moved by more than 30%).
 */
export async function currentRecommendation(address: string, snapshot: TreasurySnapshot) {
  const store = await getStore();
  const rec = await store.getLatestRecommendation(address);
  if (!rec || (rec.status !== "proposed" && rec.status !== "approved")) return rec;
  const demoChanged = rec.context ? rec.context.demoMode !== snapshot.demoMode : false;
  const drift = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.max(a, b));
  const capitalMoved = drift(rec.idleUsd, snapshot.idleUsd) > 0.3 || (rec.context ? drift(rec.context.totalUsd, snapshot.totalUsd) > 0.3 : false);
  if (!demoChanged && !capitalMoved) return rec;
  const expired = await store.updateRecommendationStatus(rec.id, "dismissed");
  await log({
    walletAddress: normalizeAddress(address),
    agentName: "Monitoring Agent",
    action: "expire",
    reasoning: demoChanged
      ? `Recommendation "${rec.title}" expired: the demo layer was turned ${snapshot.demoMode ? "on" : "off"}, so it no longer matches the treasury. Run a new analysis.`
      : `Recommendation "${rec.title}" expired: idle capital moved from ${fmtUsd(rec.idleUsd)} to ${fmtUsd(snapshot.idleUsd)}. Run a new analysis.`,
    status: "warn",
    source: "OpenServ",
  });
  return expired;
}

export async function setRecommendationStatus(address: string, id: string, status: RecommendationStatus) {
  const store = await getStore();
  const rec = await store.updateRecommendationStatus(id, status);
  if (rec && (status === "rejected" || status === "dismissed")) {
    await log({
      walletAddress: normalizeAddress(address),
      agentName: "Vaulto",
      action: status,
      reasoning: `Recommendation "${rec.title}" ${status} by the treasury manager.`,
      status: "info",
      source: "Vaulto",
    });
  }
  return rec;
}

export async function prepare(address: string, recommendationId: string, simulate = false): Promise<PreparedTransaction> {
  const store = await getStore();
  const wallet = normalizeAddress(address);
  const rec = await store.getRecommendation(recommendationId);
  if (!rec || rec.walletAddress !== wallet) throw new Error("recommendation not found");
  if (!rec.legs.length) throw new Error("nothing to execute");
  invalidateOnchain(wallet);
  const { user, snapshot, strategies } = await scan(wallet);
  if (!snapshot.onchain.rpcOk) {
    throw new Error(`${CHAIN_NAME} RPC is unavailable right now, so Vaulto cannot read balances or simulate against the vault. Try again in a few seconds.`);
  }
  const prepared = await prepareTransaction(rec, strategies, user, snapshot, { forceSimulated: simulate });
  await store.savePrepared(prepared);
  await store.updateRecommendationStatus(rec.id, "approved");
  const built = prepared.steps.every((s) => s.builtBy === "ixs-mcp") ? "IXS MCP (vault_build_request_deposit)" : "local ERC-4626 encoder (IXS MCP unreachable)";
  const sims = prepared.steps.map((s) => s.simulation).filter((s): s is NonNullable<typeof s> => Boolean(s));
  const simText = sims.length
    ? sims.every((s) => s.ok)
      ? `eth_call + state override passed (${sims.map((s) => (s.expectedShares != null ? `expected ${s.expectedShares.toFixed(4)} ${s.shareSymbol ?? "shares"}` : s.requestId ? `deposit request #${s.requestId}` : "approve ok")).join("; ")})`
      : `simulation reverted: ${sims.find((s) => !s.ok)?.revertReason}`
    : "";
  await log({
    walletAddress: wallet,
    agentName: "Execution Agent",
    action: "prepare",
    reasoning:
      prepared.executionMode === "live"
        ? `${prepared.steps.length} unsigned transaction${prepared.steps.length > 1 ? "s" : ""} built via ${built} for ${CHAIN_NAME} (${MODE_LABEL.live}: wallet holds ≥ ${LIVE_MODE_MIN_USDC} USDC). Awaiting wallet signature.`
        : `${prepared.steps.length} calldata step${prepared.steps.length > 1 ? "s" : ""} built via ${built}; ${prepared.label}: ${simText || "no simulation result"}. No transaction is sent.`,
    status: sims.length && !sims.every((s) => s.ok) ? "warn" : "success",
    source: "IXS",
  });
  return prepared;
}

export interface StepResult {
  index: number;
  hash?: string;
  status: TxStatus;
  error?: string;
}

export async function finalize(address: string, preparedId: string, results: StepResult[]) {
  const store = await getStore();
  const wallet = normalizeAddress(address);
  const prepared = await store.getPrepared(preparedId);
  if (!prepared || prepared.walletAddress !== wallet) throw new Error("prepared transaction not found");
  const rec = await store.getRecommendation(prepared.recommendationId);
  const demo = await store.getDemoState(wallet);
  const records: TransactionRecord[] = [];

  for (const step of prepared.steps) {
    const r = results.find((x) => x.index === step.index);
    if (!r) continue;
    const record: TransactionRecord = {
      id: randomUUID(),
      walletAddress: wallet,
      recommendationId: prepared.recommendationId,
      hash: r.hash,
      amountUsd: step.amountUsd,
      status: r.status,
      strategy: step.vaultName,
      description: step.description,
      chainId: step.chainId,
      explorerUrl: r.hash && step.mode === "onchain" ? `${EXPLORER}/tx/${r.hash}` : undefined,
      createdAt: new Date().toISOString(),
      kind: step.kind,
      label: step.mode === "onchain" ? MODE_LABEL.live : prepared.label,
      simulation: step.simulation,
    };
    records.push(await store.saveTransaction(record));
    const moved = (r.status === "confirmed" || r.status === "simulated") && step.kind !== "approve";
    if (moved && step.mode === "simulated") {
      demo.moves.push({ strategyId: step.strategyId, asset: step.asset, amount: step.amount, at: record.createdAt });
    }
  }
  await store.setDemoState(wallet, demo);
  const lastHash = [...results].reverse().find((r) => r.status === "confirmed" && r.hash?.startsWith("0x") && r.hash.length === 66)?.hash;
  let confirmedBlock: number | undefined;
  if (lastHash) {
    try {
      confirmedBlock = Number((await publicClient().getTransactionReceipt({ hash: lastHash as `0x${string}` })).blockNumber);
    } catch {
      confirmedBlock = undefined;
    }
  }
  invalidateOnchain(wallet, confirmedBlock);

  const failed = results.some((r) => r.status === "failed");
  const confirmedOnchain = records.filter((r) => r.status === "confirmed" && r.kind !== "approve");
  const simulated = records.filter((r) => r.status === "simulated");
  if (rec) await store.updateRecommendationStatus(rec.id, failed && !confirmedOnchain.length && !simulated.length ? "approved" : "executed");

  await log({
    walletAddress: wallet,
    agentName: "Execution Agent",
    action: "execute",
    reasoning: failed
      ? `Execution incomplete: ${results.filter((r) => r.status === "failed").length} step(s) failed or were rejected in the wallet.`
      : `${confirmedOnchain.length ? `${confirmedOnchain.length} deposit${confirmedOnchain.length > 1 ? "s" : ""} confirmed on ${CHAIN_NAME}` : ""}${confirmedOnchain.length && simulated.length ? "; " : ""}${simulated.length ? `${simulated.length} step${simulated.length > 1 ? "s" : ""} ${prepared.label} (eth_call + state override, no funds moved)` : ""}. ${fmtUsd(prepared.summary.amountUsd)} allocated.`,
    status: failed ? "warn" : "success",
    source: "IXS",
  });
  if (!failed && rec) {
    await log({
      walletAddress: wallet,
      agentName: "Monitoring Agent",
      action: "monitor",
      reasoning: `Now tracking ${rec.legs.map((l) => `${l.vaultName} (${fmtAmount(l.amount, l.asset)})`).join(" and ")}. Expected +${fmtUsd(rec.extraMonthlyUsd)} / month; health ${rec.before.healthScore} → ${rec.after.healthScore}.`,
      status: "info",
      source: "OpenServ",
    });
  }
  return { transactions: records, recommendation: rec ? await store.getRecommendation(rec.id) : null };
}

export async function riskReport(address: string) {
  const { user, snapshot, strategies } = await scan(address);
  const [rec, btcVol] = await Promise.all([currentRecommendation(address, snapshot), getBtcVolatility30d()]);
  return { report: buildRiskReport(snapshot, user, rec, btcVol, strategies), snapshot, recommendation: rec };
}

export async function portfolioReport(address: string, periodDays: number) {
  const { user, snapshot, strategies } = await scan(address);
  return { report: buildPortfolioReport(snapshot, user, periodDays), snapshot, strategies };
}

export async function activity(address: string) {
  const store = await getStore();
  const [logs, transactions] = await Promise.all([store.listLogs(address, 100), store.listTransactions(address, 100)]);
  return { logs, transactions };
}
