import { randomUUID } from "node:crypto";
import { invalidateOnchain, readOnchainTreasury } from "@/lib/chain/treasury";
import { publicClient } from "@/lib/chain/client";
import { CHAIN_NAME, LIVE_MODE_MIN_USDC, MIN_DEPOSIT_USDC, chainInfo, modeLabel } from "@/lib/chain/config";
import { erc4626Abi } from "@/lib/chain/abi";
import { formatUnits } from "viem";
import { env } from "@/lib/env";
import { recordEvidence } from "@/lib/evidence";
import { getStore, normalizeAddress } from "@/lib/db";
import { liveOptedIn } from "@/lib/live-optin";
import { fmtAmount, fmtUsd } from "@/lib/format";
import { getStrategies } from "@/lib/ixs/client";
import { nextCutoff, type CutoffInfo } from "@/lib/ixs/cutoff";
import { runPreflight } from "@/lib/ixs/preflight";
import { findRegistryVault, getRegistry } from "@/lib/ixs/registry";
import { watchRegistry, watchStatus } from "@/lib/ixs/watch";
import { getBtcVolatility30d, getPrices } from "@/lib/prices";
import { scanTreasury } from "@/lib/agents/scanner";
import { findOpportunities } from "@/lib/agents/finder";
import { assessCandidates } from "@/lib/agents/risk";
import { buildPlan, localLegs, planConstraints } from "@/lib/agents/planner";
import { prepareTransaction } from "@/lib/agents/execution";
import { buildPortfolioReport, buildRiskReport } from "@/lib/agents/monitoring";
import { decideAllocation, narrate, type VaultDecision } from "@/lib/openserv/reasoning";
import type {
  AgentLog,
  AnalysisResult,
  PreparedTransaction,
  Recommendation,
  RecommendationStatus,
  RejectedOption,
  TransactionRecord,
  TreasurySnapshot,
  TxStatus,
  UserPatch,
  UserProfile,
  VaultPreflight,
  VaultStrategy,
} from "@/lib/types";

/**
 * Agent Orchestrator — coordinates the multi-agent pipeline, the IXS adapter, SERV (OpenServ) reasoning and
 * persistence. Every API route delegates here.
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
  watch: ReturnType<typeof watchStatus>;
  cutoff: CutoffInfo;
}

const log = async (entry: Omit<AgentLog, "id" | "createdAt">) => (await getStore()).addLog(entry);

export async function scan(address: string): Promise<ScanResult> {
  const store = await getStore();
  const [user, demoState, onchain, prices, { strategies, liveOk }, liveOptIn] = await Promise.all([
    store.getOrCreateUser(address),
    store.getDemoState(address),
    readOnchainTreasury(address),
    getPrices(),
    loadStrategies(),
    liveOptedIn(address),
  ]);
  const snapshot = scanTreasury({ user, onchain, prices, strategies, demoState, liveOptIn });
  store.saveTreasurySnapshot(address, snapshot.assets).catch(() => undefined);

  // NAV / deposit-limit watcher: log every change the Monitoring Agent sees.
  const events = watchRegistry(await getRegistry());
  for (const e of events) {
    await log({ walletAddress: normalizeAddress(address), agentName: "Monitoring Agent", action: "watch", reasoning: e.message, status: e.kind === "limit" && /reopened/.test(e.message) ? "success" : "info", source: "IXS" });
  }
  return { user, snapshot, strategies, liveOk, watch: watchStatus(), cutoff: nextCutoff() };
}

function emptyMetrics(snapshot: TreasurySnapshot) {
  return { liquidPct: snapshot.liquidPct, blendedApy: snapshot.blendedApy, healthScore: snapshot.healthScore, idlePct: snapshot.idlePct, allocatedPct: snapshot.allocatedPct, perStrategyPct: {} };
}

export async function analyze(address: string): Promise<AnalysisResult> {
  const started = Date.now();
  const store = await getStore();
  const wallet = normalizeAddress(address);
  const { user, snapshot, strategies, cutoff } = await scan(wallet);
  const logs: AgentLog[] = [];

  logs.push(
    await log({
      walletAddress: wallet,
      agentName: "Treasury Scanner Agent",
      action: "scan",
      reasoning: `Scanned ${snapshot.assets.length} assets, ${snapshot.positions.length} IXS positions${snapshot.onchain.rpcOk ? ` (${Object.entries(snapshot.onchain.byChain ?? {}).filter(([, c]) => c.rpcOk).map(([id, c]) => `${chainInfo(Number(id)).name} block ${c.blockNumber}`).join(", ")})` : ""}. ${snapshot.idlePct}% of capital idle. Execution mode: ${snapshot.executionMode}.`,
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
      reasoning: `${fmtUsd(snapshot.idleUsd, { compact: true })} inefficient capital, opportunity score ${snapshot.opportunityScore}. ${candidates.length} IXS candidates match idle assets: ${candidates.map((c) => `${c.strategy.vaultName}${c.available ? "" : " (announced, not deployed)"}`).join(", ")}.`,
      status: "info",
      source: "OpenServ",
    }),
  );

  // Pre-flight per candidate vault: deposit limit, NAV age, minimum deposit, MCP build probe, eligibility, cutoff.
  const registry = await getRegistry();
  const preflights: Record<string, VaultPreflight> = {};
  await Promise.all(
    candidates
      .filter((c) => c.available && c.strategy.routeId)
      .map(async (c) => {
        const rv = findRegistryVault(registry, c.strategy.routeId);
        if (!rv) return;
        // Live (opt-in) legs must also clear the redeemable minimum, and only the balance on that chain counts.
        const live = snapshot.liveChainIds.includes(c.strategy.chainId);
        const minFor = live ? Math.max(MIN_DEPOSIT_USDC, c.strategy.terms?.minLiveDepositUsd ?? MIN_DEPOSIT_USDC) : MIN_DEPOSIT_USDC;
        const idleHere = live ? Math.min(c.idleUsd, snapshot.onchain.byChain?.[c.strategy.chainId]?.balances[c.asset] ?? 0) : c.idleUsd;
        const p = await runPreflight(rv, wallet, idleHere < minFor ? idleHere : undefined, { live });
        preflights[c.strategy.id] = p;
        c.strategy.preflight = p;
      }),
  );

  const verdict = assessCandidates(candidates, snapshot, user, preflights);
  const constraints = planConstraints(snapshot, verdict.approved, user, { maxLiveTxUsd: env.maxLiveTxUsdc });
  logs.push(
    await log({
      walletAddress: wallet,
      agentName: "Risk Guardian Agent",
      action: "evaluate",
      reasoning: `Pre-flight: ${verdict.assessments.map((a) => `${a.candidate.strategy.vaultName} → ${a.verdictHint}${a.preflight ? ` (limit ${a.preflight.depositLimitUnlimited ? "unlimited" : `${a.preflight.depositLimitUsd ?? "?"} USDC`}, NAV ${a.preflight.navAgeHours != null ? `${(a.preflight.navAgeHours / 24).toFixed(1)} d old` : "unknown"}, min ${a.preflight.minDepositUsd} USDC${a.preflight.whitelisted === false ? ", not whitelisted" : ""})` : " (no vault deployed)"}`).join("; ")}. ${constraints ? `Budget ${fmtUsd(constraints.budgetUsd)} with ${fmtUsd(constraints.keepLiquidUsd)} kept liquid${constraints.stableReserveUsd ? ` and ${fmtUsd(constraints.stableReserveUsd)} stablecoin runway reserved` : ""}.` : "No vault passes pre-flight and policy, so there is no budget to size."}`,
      status: verdict.approved.length ? "info" : "warn",
      source: "OpenServ",
    }),
  );

  // SERV reasoning decides per vault; the Planner validates amounts against caps and pre-flight.
  const fallback = constraints ? localLegs(constraints) : [];
  const decision = await decideAllocation({ user, snapshot, assessments: verdict.assessments, constraints, policyChecks: verdict.policyChecks, fallback, fallbackDecisions: verdict.fallbackDecisions, cutoff });
  const approvedIds = new Set(verdict.approved.map((c) => c.strategy.id));
  const validatorNotes: string[] = [];
  const decisions: VaultDecision[] = decision.decisions.map((d) => {
    if (d.verdict === "allocate" && !approvedIds.has(d.strategyId)) {
      const hint = verdict.fallbackDecisions.find((f) => f.strategyId === d.strategyId);
      validatorNotes.push(`${d.strategyId}: SERV proposed an allocation but pre-flight is ${hint?.verdict ?? "not passing"}; validator applied ${hint?.verdict ?? "defer"}`);
      return { ...d, verdict: hint?.verdict ?? "defer", amount: undefined, reason: `${hint?.reason ?? "pre-flight not passing"} (validator override of a SERV allocation)` };
    }
    if (d.verdict === "allocate") {
      const cap = constraints?.caps.find((c) => c.strategyId === d.strategyId);
      const dropped = constraints?.dropped.find((x) => x.strategyId === d.strategyId);
      if (!cap) {
        validatorNotes.push(`${d.strategyId}: SERV proposed an allocation but the Planner has no cap for it${dropped ? ` (${dropped.reason})` : " (no budget above the liquidity floor)"}; validator applied ${dropped ? "reject" : "defer"}`);
        return { ...d, verdict: dropped ? ("reject" as const) : ("defer" as const), amount: undefined, reason: `${dropped?.reason ?? "No budget remains above the liquidity floor and runway reserve"} (validator override of a SERV allocation)` };
      }
      if (d.amount != null && d.amount * cap.priceUsd < cap.minUsd) {
        validatorNotes.push(`${d.strategyId}: SERV amount ${d.amount} is below the ${cap.minNote}; validator applied reject`);
        return { ...d, verdict: "reject" as const, amount: undefined, reason: `${d.reason} Below the ${cap.minNote} (validator override of a SERV allocation).` };
      }
    }
    return d;
  });
  let plan = constraints ? buildPlan(snapshot, verdict.approved, user, constraints, decisions.filter((d) => d.verdict === "allocate" && d.amount).map((d) => ({ strategyId: d.strategyId, amount: d.amount! }))) : null;
  let decisionSource = decision.source;
  if (!plan && constraints && decision.source === "openserv" && decision.legs.length) {
    plan = buildPlan(snapshot, verdict.approved, user, constraints, fallback);
    decisionSource = "local";
    validatorNotes.push("SERV amounts did not survive validation; deterministic sizing used within the same caps");
  }

  const labelOf = (id: string) => {
    const a = verdict.assessments.find((x) => x.candidate.strategy.id === id);
    const s = a?.candidate.strategy ?? strategies.find((x) => x.id === id);
    return s ? `${s.vaultName}${s.apy != null ? ` · ${s.apy.toFixed(2)}%` : ""}${a ? ` · idle ${fmtAmount(a.candidate.idleAmount, a.candidate.asset)}` : ""}` : id;
  };
  const rejected: RejectedOption[] = [...decisions.filter((d) => d.verdict === "reject").map((d) => ({ option: labelOf(d.strategyId), reason: d.reason, tone: "warn" as const, verdict: "reject" as const })), ...verdict.notes];
  const deferred: RejectedOption[] = decisions.filter((d) => d.verdict === "defer").map((d) => ({ option: labelOf(d.strategyId), reason: d.reason, tone: "warn" as const, verdict: "defer" as const }));

  logs.push(
    await log({
      walletAddress: wallet,
      agentName: "Allocation Planner Agent",
      action: "plan",
      reasoning: `${decisionSource === "openserv" ? `SERV reasoning (${decision.model ?? "OpenServ"})` : "Deterministic engine"} verdicts: ${decisions.map((d) => `${strategies.find((s) => s.id === d.strategyId)?.vaultName ?? d.strategyId} → ${d.verdict.toUpperCase()}${d.verdict === "allocate" && d.amount ? ` ${d.amount.toLocaleString("en-US")}` : ""}`).join("; ")}. ${plan ? `Plan: ${plan.legs.map((l) => `${fmtAmount(l.amount, l.asset)} → ${l.vaultName}`).join(", ")} within a ${fmtUsd(constraints!.budgetUsd)} budget.` : "No allocation now."}${decision.rationale ? ` Rationale: ${decision.rationale}` : ""}${validatorNotes.length ? ` Validator: ${validatorNotes.join("; ")}.` : ""}`,
      status: plan ? "success" : "warn",
      source: "OpenServ",
    }),
  );

  const narrative = await narrate({
    user,
    snapshot,
    assessments: verdict.assessments,
    decisions,
    legs: plan?.legs ?? [],
    before: plan?.before ?? emptyMetrics(snapshot),
    after: plan?.after ?? emptyMetrics(snapshot),
    rejected,
    deferred,
    extraMonthlyUsd: plan?.extraMonthlyUsd ?? 0,
    totalUsd: plan?.totalUsd ?? 0,
    policyChecks: verdict.policyChecks,
    decisionRationale: decision.rationale,
    cutoff,
  });

  logs.push(
    await log({
      walletAddress: wallet,
      agentName: "SERV Reasoning",
      action: "explain",
      reasoning: `${plan ? `${fmtUsd(plan.totalUsd)} across ${plan.legs.map((l) => l.vaultName).join(" and ")}` : "No allocation"}; ${deferred.length} deferred, ${rejected.length} rejected. Memo + explanation by ${narrative.source === "openserv" ? `OpenServ (${narrative.model ?? "platform model"})` : "Vaulto local engine"}, confidence ${narrative.confidence}%.`,
      status: "success",
      source: "OpenServ",
    }),
  );

  const rec: Recommendation = {
    id: randomUUID(),
    walletAddress: wallet,
    title: plan ? narrative.title : "No allocation right now",
    headline: plan ? narrative.headline : narrative.headline,
    foundLabel: `${fmtUsd(snapshot.idleUsd)} ${plan ? "inefficient" : "idle"} capital`,
    summary: narrative.summary,
    legs: plan?.legs ?? [],
    before: plan?.before ?? emptyMetrics(snapshot),
    after: plan?.after ?? emptyMetrics(snapshot),
    totalUsd: plan?.totalUsd ?? 0,
    extraMonthlyUsd: plan?.extraMonthlyUsd ?? 0,
    confidence: narrative.confidence,
    reasons: narrative.reasons,
    steps: narrative.steps,
    rejected,
    deferred,
    decisions,
    memo: narrative.memo,
    status: plan ? "proposed" : "dismissed",
    reasoningSource: decisionSource === "openserv" || narrative.source === "openserv" ? "openserv" : "local",
    reasoningModel: narrative.model ?? decision.model,
    durationMs: Date.now() - started,
    createdAt: new Date().toISOString(),
    txCount: plan?.txCount ?? 0,
    feeUsd: plan?.feeUsd ?? 0,
    idleUsd: snapshot.idleUsd,
    context: { demoMode: snapshot.demoMode, totalUsd: snapshot.totalUsd },
    preflights,
    validatorOverrides: validatorNotes,
    guardrails: {
      liquidityFloorPct: user.liquidityFloorPct,
      maxAssetExposurePct: user.maxAssetExposurePct,
      minVaultRiskScore: user.minVaultRiskScore,
      minDepositUsd: MIN_DEPOSIT_USDC,
      maxLiveTxUsdc: env.maxLiveTxUsdc,
      navStaleHours: env.navStaleHours,
      liveMode: env.liveMode,
      liveOptIn: snapshot.liveOptIn,
      liveDepositMinimums: strategies
        .filter((s) => s.executable && s.terms?.minLiveDepositUsd != null)
        .map((s) => ({ strategyId: s.id, vault: s.vaultName, symbol: s.shareSymbol ?? s.vaultName, usd: s.terms!.minLiveDepositUsd!, formula: s.terms!.minLiveDepositFormula ?? "", reason: s.terms!.minLiveDepositReason ?? "" })),
    },
    trace: { source: decision.source, model: decision.model ?? narrative.model, at: new Date().toISOString(), decision: { input: decision.input, output: decision.output }, narrative: narrative.input ? { input: narrative.input, output: narrative.output } : undefined },
    cutoff,
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
      ? `Recommendation "${rec.title}" expired: the simulated treasury layer was turned ${snapshot.demoMode ? "on" : "off"}, so it no longer matches the treasury. Run a new analysis.`
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

/**
 * On serverless hosting the JSON store lives in memory per instance, so the client sends the recommendation it
 * holds back with the request; it is only accepted for the same wallet and id, and pre-flight is re-run before any
 * calldata is built (execution.ts checks rec.preflights, which are refreshed here).
 */
async function recoverRecommendation(store: Awaited<ReturnType<typeof getStore>>, wallet: string, id: string, fromClient?: Recommendation): Promise<Recommendation | null> {
  const stored = await store.getRecommendation(id);
  if (stored) return stored;
  if (!fromClient || fromClient.id !== id || normalizeAddress(fromClient.walletAddress) !== wallet) return null;
  const registry = await getRegistry();
  const { strategies } = await loadStrategies();
  const preflights: Record<string, VaultPreflight> = {};
  await Promise.all(
    fromClient.legs.map(async (l) => {
      const s = strategies.find((x) => x.id === l.strategyId);
      const rv = s ? findRegistryVault(registry, s.routeId) : undefined;
      if (rv) preflights[l.strategyId] = await runPreflight(rv, wallet, l.amountUsd);
    }),
  );
  const rec: Recommendation = { ...fromClient, walletAddress: wallet, preflights: { ...(fromClient.preflights ?? {}), ...preflights } };
  await store.saveRecommendation(rec);
  return rec;
}

export async function prepare(address: string, recommendationId: string, simulate = false, fromClient?: Recommendation): Promise<PreparedTransaction> {
  const store = await getStore();
  const wallet = normalizeAddress(address);
  const rec = await recoverRecommendation(store, wallet, recommendationId, fromClient);
  if (!rec || rec.walletAddress !== wallet) throw new Error("recommendation not found (run the analysis again)");
  if (!rec.legs.length) throw new Error("nothing to execute: every vault was deferred or rejected");
  invalidateOnchain(wallet);
  const { user, snapshot, strategies } = await scan(wallet);
  if (!snapshot.onchain.rpcOk) {
    throw new Error(`${CHAIN_NAME} RPC is unavailable right now, so Vaulto cannot read balances or simulate against the vault. Try again in a few seconds.`);
  }
  const prepared = await prepareTransaction(rec, strategies, user, snapshot, { forceSimulated: simulate });
  await store.savePrepared(prepared);
  await store.updateRecommendationStatus(rec.id, "approved");
  const built = prepared.steps.every((s) => s.builtBy === "ixs-mcp") ? "IXS MCP (vault_build_request_deposit)" : "direct vault calldata (IXS MCP unreachable)";
  const sims = prepared.steps.map((s) => s.simulation).filter((s): s is NonNullable<typeof s> => Boolean(s));
  const simText = sims.length
    ? sims.every((s) => s.ok)
      ? `eth_call + state override passed (${sims.map((s) => (s.expectedShares != null ? `expected ${s.expectedShares.toFixed(4)} ${s.shareSymbol ?? "shares"}` : s.requestId ? `deposit request #${s.requestId} accepted` : "approve ok")).join("; ")})`
      : `simulation reverted: ${sims.find((s) => !s.ok)?.revertReason}`
    : "";
  await log({
    walletAddress: wallet,
    agentName: "Execution Agent",
    action: "prepare",
    reasoning:
      prepared.executionMode === "live"
        ? `${prepared.steps.length} unsigned transaction${prepared.steps.length > 1 ? "s" : ""} built via ${built} (${prepared.label}: wallet holds ≥ ${LIVE_MODE_MIN_USDC} USDC on that chain, hard cap per transaction applies). Awaiting wallet signature.`
        : `${prepared.steps.length} calldata step${prepared.steps.length > 1 ? "s" : ""} built via ${built}; ${prepared.label}: ${simText || "no simulation result"}. No transaction is sent.${prepared.notes.length ? ` Notes: ${prepared.notes.join("; ")}.` : ""}`,
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

export async function finalize(address: string, preparedId: string, results: StepResult[], fromClient?: { prepared?: PreparedTransaction; recommendation?: Recommendation }) {
  const store = await getStore();
  const wallet = normalizeAddress(address);
  let prepared = await store.getPrepared(preparedId);
  if (!prepared && fromClient?.prepared && fromClient.prepared.id === preparedId && normalizeAddress(fromClient.prepared.walletAddress) === wallet) {
    prepared = { ...fromClient.prepared, walletAddress: wallet };
    await store.savePrepared(prepared);
  }
  if (!prepared || prepared.walletAddress !== wallet) throw new Error("prepared transaction not found");
  const rec = (await store.getRecommendation(prepared.recommendationId)) ?? (await recoverRecommendation(store, wallet, prepared.recommendationId, fromClient?.recommendation));
  const demo = await store.getDemoState(wallet);
  const records: TransactionRecord[] = [];
  const cutoff = nextCutoff();

  for (const step of prepared.steps) {
    const r = results.find((x) => x.index === step.index);
    if (!r) continue;
    const asyncRequest = step.kind === "requestDeposit";
    const settlementNote = asyncRequest && r.status === "confirmed" ? ` · Request submitted — pending operator settlement (next cutoff ${cutoff.nextCutoffSgt}, est. settlement ${cutoff.estimatedSettlementSgt})` : "";
    const record: TransactionRecord = {
      id: randomUUID(),
      walletAddress: wallet,
      recommendationId: prepared.recommendationId,
      hash: r.hash,
      amountUsd: step.amountUsd,
      status: r.status,
      strategy: step.vaultName,
      description: `${step.description}${settlementNote}`,
      chainId: step.chainId,
      explorerUrl: r.hash && step.mode === "onchain" ? `${chainInfo(step.chainId).explorer}/tx/${r.hash}` : undefined,
      createdAt: new Date().toISOString(),
      kind: step.kind,
      label: step.label ?? prepared.label,
      simulation: step.simulation,
    };
    records.push(await store.saveTransaction(record));
    const moved = (r.status === "confirmed" || r.status === "simulated") && step.kind !== "approve";
    if (moved && step.mode === "simulated") {
      demo.moves.push({ strategyId: step.strategyId, asset: step.asset, amount: step.amount, at: record.createdAt });
    }
  }
  await store.setDemoState(wallet, demo);

  // Live mainnet evidence: receipt (block, gas, status) per confirmed step, then the vault shares now held.
  const strategiesNow = (await loadStrategies()).strategies;
  for (const step of prepared.steps) {
    const r = results.find((x) => x.index === step.index);
    if (!r || r.status !== "confirmed" || step.mode !== "onchain" || !r.hash?.startsWith("0x")) continue;
    const client = publicClient(step.chainId);
    const label = modeLabel("live", step.chainId, prepared.rpcKind);
    try {
      const receipt = await client.getTransactionReceipt({ hash: r.hash as `0x${string}` });
      let shares: { balance: number; valueUsdc: number; symbol: string } | null = null;
      if (step.kind !== "approve") {
        const s = strategiesNow.find((x) => x.id === step.strategyId);
        if (s?.contractAddress) {
          const bal = await client.readContract({ address: s.contractAddress as `0x${string}`, abi: erc4626Abi, functionName: "balanceOf", args: [wallet as `0x${string}`] }).catch(() => 0n);
          const val = await client.readContract({ address: s.contractAddress as `0x${string}`, abi: erc4626Abi, functionName: "convertToAssets", args: [bal] }).catch(() => 0n);
          shares = { balance: Number(formatUnits(bal, s.shareDecimals ?? 18)), valueUsdc: Number(formatUnits(val, s.assetDecimals ?? 18)), symbol: s.shareSymbol ?? "shares" };
        }
      }
      recordEvidence({
        kind: "live",
        label: `${label} · ${step.kind === "approve" ? "approve (exact amount)" : step.kind === "requestDeposit" ? "requestDeposit — pending operator settlement" : "deposit confirmed"} · ${step.vaultName}`,
        chainId: step.chainId,
        blockNumber: Number(receipt.blockNumber),
        request: { hash: r.hash, to: step.to, kind: step.kind, amount: step.amount, asset: step.asset, wallet, builtBy: step.builtBy, explorer: `${chainInfo(step.chainId).explorer}/tx/${r.hash}` },
        response: { status: receipt.status, gasUsed: Number(receipt.gasUsed), block: Number(receipt.blockNumber), sharesAfter: shares },
        ok: receipt.status === "success",
      });
    } catch (e) {
      recordEvidence({ kind: "live", label: `${label} · ${step.kind} · receipt unavailable`, chainId: step.chainId, request: { hash: r.hash }, response: { error: e instanceof Error ? e.message : String(e) }, ok: false });
    }
  }

  const lastConfirmed = [...prepared.steps].reverse().find((s) => results.find((r) => r.index === s.index && r.status === "confirmed" && r.hash?.startsWith("0x") && r.hash.length === 66));
  let confirmedBlock: number | undefined;
  if (lastConfirmed) {
    const hash = results.find((r) => r.index === lastConfirmed.index)!.hash as `0x${string}`;
    try {
      confirmedBlock = Number((await publicClient(lastConfirmed.chainId).getTransactionReceipt({ hash })).blockNumber);
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
      : `${confirmedOnchain.length ? `${confirmedOnchain.length} ${confirmedOnchain.some((r) => r.kind === "requestDeposit") ? "deposit request(s) submitted (pending operator settlement)" : "deposit(s) confirmed"} on-chain` : ""}${confirmedOnchain.length && simulated.length ? "; " : ""}${simulated.length ? `${simulated.length} step${simulated.length > 1 ? "s" : ""} ${prepared.label} (eth_call + state override, no funds moved)` : ""}. ${fmtUsd(prepared.summary.amountUsd)} allocated.`,
    status: failed ? "warn" : "success",
    source: "IXS",
  });
  if (!failed && rec) {
    await log({
      walletAddress: wallet,
      agentName: "Monitoring Agent",
      action: "monitor",
      reasoning: `Now tracking ${rec.legs.map((l) => `${l.vaultName} (${fmtAmount(l.amount, l.asset)})`).join(" and ")}. Expected +${fmtUsd(rec.extraMonthlyUsd)} / month; health ${rec.before.healthScore} → ${rec.after.healthScore}. Watching NAV updates and deposit limits on every scan.`,
      status: "info",
      source: "OpenServ",
    });
  }
  return { transactions: records, recommendation: rec ? await store.getRecommendation(rec.id) : null };
}

export async function riskReport(address: string) {
  const { user, snapshot, strategies, watch } = await scan(address);
  const [rec, btcVol] = await Promise.all([currentRecommendation(address, snapshot), getBtcVolatility30d()]);
  return { report: buildRiskReport(snapshot, user, rec, btcVol, strategies, watch), snapshot, recommendation: rec };
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
