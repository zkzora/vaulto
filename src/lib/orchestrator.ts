import { randomUUID } from "node:crypto";
import { invalidateOnchain, readOnchainTreasury } from "@/lib/chain/treasury";
import { EXPLORER, publicClient } from "@/lib/chain/client";
import { CHAIN_NAME } from "@/lib/chain/config";
import { getStore, normalizeAddress } from "@/lib/db";
import { fmtAmount, fmtUsd } from "@/lib/format";
import { checkWhitelist, getStrategies } from "@/lib/ixs/client";
import { getBtcVolatility30d, getPrices } from "@/lib/prices";
import { scanTreasury } from "@/lib/agents/scanner";
import { findOpportunities } from "@/lib/agents/finder";
import { guardCandidates } from "@/lib/agents/risk";
import { planAllocation } from "@/lib/agents/planner";
import { prepareTransaction } from "@/lib/agents/execution";
import { buildPortfolioReport, buildRiskReport } from "@/lib/agents/monitoring";
import { narrate } from "@/lib/openserv/reasoning";
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
 * Agent Orchestrator — coordinates the multi-agent pipeline, the IXS adapter, OpenServ reasoning
 * and persistence. Every API route delegates here.
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

export async function loadStrategies(): Promise<{ strategies: VaultStrategy[]; liveOk: boolean }> {
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
      reasoning: `${fmtUsd(snapshot.idleUsd, { compact: true })} inefficient capital, opportunity score ${snapshot.opportunityScore}. ${candidates.length} IXS strategies match idle assets.`,
      status: "info",
      source: "OpenServ",
    }),
  );

  // Eligibility for whitelisted vaults through IXS MCP (only when a routeId is known to IXS).
  const whitelist: Record<string, boolean | null> = {};
  await Promise.all(
    candidates
      .filter((c) => c.strategy.requiresWhitelist && c.strategy.routeId)
      .map(async (c) => {
        whitelist[c.strategy.id] = await checkWhitelist(c.strategy.routeId!, wallet);
      }),
  );

  const verdict = guardCandidates(candidates, snapshot, user, whitelist);
  const plan = planAllocation(snapshot, verdict.approved, user);
  logs.push(
    await log({
      walletAddress: wallet,
      agentName: "Risk Guardian Agent",
      action: "evaluate",
      reasoning: plan
        ? `Validated policy. ${plan.after.liquidPct}% liquid after deploy, floor ${user.liquidityFloorPct}%. ${verdict.rejected.length} options rejected.`
        : `No allocation passes policy right now (${verdict.policyChecks.map((c) => `${c.label}: ${c.ok ? "ok" : "fail"}`).join(", ")}).`,
      status: plan ? "info" : "warn",
      source: "OpenServ",
    }),
  );

  if (!plan) {
    const rec: Recommendation = {
      id: randomUUID(),
      walletAddress: wallet,
      title: "No allocation recommended",
      headline: "Treasury is already deployed within policy. Vaulto will keep monitoring.",
      foundLabel: `${fmtUsd(snapshot.idleUsd)} idle capital`,
      summary: "There is no idle capital above your liquidity floor to deploy safely. Nothing to approve.",
      legs: [],
      before: { liquidPct: snapshot.liquidPct, blendedApy: snapshot.blendedApy, healthScore: snapshot.healthScore, idlePct: snapshot.idlePct, allocatedPct: snapshot.allocatedPct, perStrategyPct: {} },
      after: { liquidPct: snapshot.liquidPct, blendedApy: snapshot.blendedApy, healthScore: snapshot.healthScore, idlePct: snapshot.idlePct, allocatedPct: snapshot.allocatedPct, perStrategyPct: {} },
      totalUsd: 0,
      extraMonthlyUsd: 0,
      confidence: 90,
      reasons: [{ title: "Liquidity floor respected.", body: `Idle capital (${snapshot.idlePct}%) is at or below the ${user.liquidityFloorPct}% floor plus buffer.` }],
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
  });

  logs.push(
    await log({
      walletAddress: wallet,
      agentName: "Allocation Planner Agent",
      action: "plan",
      reasoning: `${fmtUsd(plan.totalUsd)} split across ${plan.legs.map((l) => l.vaultName).join(" and ")}. Reasoning by ${narrative.source === "openserv" ? `OpenServ (${narrative.model ?? "platform model"})` : "Vaulto local engine"}, confidence ${narrative.confidence}%.`,
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
    reasoningSource: narrative.source,
    reasoningModel: narrative.model,
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
  if (!simulate && !user.demoMode && !snapshot.onchain.rpcOk) {
    throw new Error(`${CHAIN_NAME} RPC is unavailable right now, so Vaulto cannot verify your on-chain balances. Try again in a few seconds.`);
  }
  const prepared = await prepareTransaction(rec, strategies, user, snapshot, { simulate });
  await store.savePrepared(prepared);
  await store.updateRecommendationStatus(rec.id, "approved");
  const onchain = prepared.steps.filter((s) => s.mode === "onchain");
  await log({
    walletAddress: wallet,
    agentName: "Execution Agent",
    action: "prepare",
    reasoning:
      onchain.length > 0
        ? `${onchain.length} unsigned transaction${onchain.length > 1 ? "s" : ""} built via ${onchain[0].builtBy === "ixs-mcp" ? "IXS MCP" : "IXS adapter (ERC-4626 calldata)"} for ${CHAIN_NAME}. Awaiting wallet signature.`
        : `Transaction workflow prepared via IXS Agent Rail (${prepared.steps.length} step${prepared.steps.length > 1 ? "s" : ""}, simulated rail). Awaiting approval.`,
    status: "success",
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
  const price = (asset: string) => (asset === "BTC" ? undefined : 1);

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
    };
    records.push(await store.saveTransaction(record));
    const moved = (r.status === "confirmed" || r.status === "simulated") && step.kind !== "approve";
    if (moved && step.mode === "simulated") {
      demo.moves.push({ strategyId: step.strategyId, asset: step.asset, amount: step.amount, at: record.createdAt });
    }
    void price;
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
      : `${confirmedOnchain.length ? `${confirmedOnchain.length} deposit${confirmedOnchain.length > 1 ? "s" : ""} confirmed on ${CHAIN_NAME}` : ""}${confirmedOnchain.length && simulated.length ? "; " : ""}${simulated.length ? `${simulated.length} step${simulated.length > 1 ? "s" : ""} executed on the simulated IXS rail` : ""}. ${fmtUsd(prepared.summary.amountUsd)} allocated.`,
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
  const { user, snapshot } = await scan(address);
  const [rec, btcVol] = await Promise.all([currentRecommendation(address, snapshot), getBtcVolatility30d()]);
  return { report: buildRiskReport(snapshot, user, rec, btcVol), snapshot, recommendation: rec };
}

export async function portfolioReport(address: string, periodDays: number) {
  const { snapshot, strategies } = await scan(address);
  return { report: buildPortfolioReport(snapshot, periodDays), snapshot, strategies };
}

export async function activity(address: string) {
  const store = await getStore();
  const [logs, transactions] = await Promise.all([store.listLogs(address, 100), store.listTransactions(address, 100)]);
  return { logs, transactions };
}
