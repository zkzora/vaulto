import { randomUUID } from "node:crypto";
import { parseUnits } from "viem";
import { simulateDepositSteps } from "@/lib/chain/simulate";
import { rpcKind } from "@/lib/chain/client";
import { chainInfo, modeLabel, type ExecutionMode } from "@/lib/chain/config";
import { env } from "@/lib/env";
import { buildDepositSteps } from "@/lib/ixs/client";
import { fmtAmount, fmtUsd, shortAddress } from "@/lib/format";
import type { PreparedTransaction, Recommendation, TxStep, UserProfile, VaultStrategy, TreasurySnapshot } from "@/lib/types";

/**
 * Execution Agent — turns an approved recommendation into a transaction workflow against the real IXS vaults.
 *
 * - Every leg is built as approve (exact amount) + deposit / requestDeposit calldata by the IXS MCP.
 * - Legs whose pre-flight did not pass (deferred / rejected) are never built.
 * - Live mode (opt-in in Settings, wallet holds >= 100 USDC on the vault's chain): steps are returned unsigned for the
 *   wallet to sign, capped at MAX_LIVE_TX_USDC per transaction and never below the Live redeemable minimum.
 * - Simulated mode: the same calldata runs through eth_call with a state override (balance + allowance) against the
 *   vault on that chain's mainnet (or a local Anvil fork); expected shares / revert reason are attached.
 */
export async function prepareTransaction(
  rec: Recommendation,
  strategies: VaultStrategy[],
  user: UserProfile,
  snapshot: TreasurySnapshot,
  opts: { forceSimulated: boolean },
): Promise<PreparedTransaction> {
  const byId = new Map(strategies.map((s) => [s.id, s]));
  const steps: TxStep[] = [];
  const notes: string[] = [];
  const modes = new Set<ExecutionMode>();
  const labels = new Set<string>();
  let index = 0;

  for (const leg of rec.legs) {
    const s = byId.get(leg.strategyId);
    if (!s?.executable || !s.contractAddress || !s.assetAddress || s.assetDecimals == null) {
      notes.push(`${leg.vaultName}: not executable (no live IXS vault)`);
      continue;
    }
    const preflight = rec.preflights?.[s.id];
    if (preflight && preflight.verdict !== "allocate") {
      notes.push(`${leg.vaultName}: pre-flight ${preflight.verdict} (${preflight.checks.filter((c) => !c.ok && c.severity !== "info").map((c) => c.label).join(", ")}); nothing built`);
      continue;
    }
    const chain = chainInfo(s.chainId);
    const kind = rpcKind(s.chainId);
    const balanceOnChain = snapshot.onchain.byChain?.[s.chainId]?.balances[leg.asset] ?? 0;
    const liveHere = !opts.forceSimulated && snapshot.liveChainIds.includes(s.chainId) && balanceOnChain > 0;
    const mode: ExecutionMode = liveHere ? "live" : "simulated";
    const price = snapshot.prices[leg.asset] ?? 1;
    let amount = mode === "live" ? Math.min(leg.amount, balanceOnChain) : leg.amount;
    if (mode === "live" && amount > env.maxLiveTxUsdc / price) {
      amount = Math.floor(env.maxLiveTxUsdc / price);
      notes.push(`${leg.vaultName}: capped at the ${env.maxLiveTxUsdc.toLocaleString("en-US")} USDC per-transaction hard cap (MAX_LIVE_TX_USDC)`);
    }
    if (amount <= 0) {
      notes.push(`${leg.vaultName}: wallet holds no ${leg.asset} on ${chain.name}`);
      continue;
    }
    if (mode === "live") {
      const minLive = Math.max(s.terms?.minDepositUsd ?? 0, s.terms?.minLiveDepositUsd ?? 0);
      if (amount * price < minLive) {
        notes.push(`${leg.vaultName}: ${fmtAmount(amount, leg.asset)} is below the Live deposit minimum of ${minLive} ${leg.asset} (${s.terms?.minLiveDepositFormula ?? "redeemable minimum"}); nothing built`);
        continue;
      }
    }
    const label = snapshot.replay ? snapshot.replay.label : modeLabel(mode, s.chainId, kind);
    modes.add(mode);
    labels.add(label);

    const built = await buildDepositSteps(s, user.walletAddress, amount, { preflightOk: preflight?.verdict === "allocate" || !preflight, simulation: mode === "simulated" });
    if (built.note) notes.push(built.note);
    const legSteps: TxStep[] = built.steps.map((st) => ({ ...st, index: index++, mode: mode === "live" ? "onchain" : "simulated", amountUsd: Math.round(st.amount * price), note: built.note, label }));

    if (mode === "simulated") {
      const units = parseUnits(amount.toFixed(Math.min(s.assetDecimals, 6)), s.assetDecimals);
      try {
        const sims = await simulateDepositSteps({
          chainId: s.chainId,
          owner: user.walletAddress as `0x${string}`,
          steps: legSteps,
          asset: { address: s.assetAddress as `0x${string}`, decimals: s.assetDecimals, symbol: s.asset },
          vault: s.contractAddress as `0x${string}`,
          amountUnits: units,
          shareDecimals: s.shareDecimals ?? 18,
          shareSymbol: s.shareSymbol ?? "shares",
        });
        for (const st of legSteps) st.simulation = sims[st.index];
      } catch (e) {
        const reason = e instanceof Error ? e.message : "simulation unavailable";
        for (const st of legSteps) st.simulation = { ok: false, label, overrides: [], revertReason: reason };
      }
    }
    steps.push(...legSteps);
  }

  if (!steps.length) throw new Error(`Nothing to execute: ${notes.join("; ") || "no executable leg"}`);

  const mode: ExecutionMode = modes.has("live") && !modes.has("simulated") ? "live" : "simulated";
  const label = [...labels].join(" + ");
  const chainIds = [...new Set(steps.map((s) => s.chainId))];
  const scores = rec.legs.map((l) => l.riskScore);
  const minScore = Math.min(...scores);
  const destination = rec.legs.map((l) => l.vaultName).join(" + ");
  const destAddress = strategies.find((s) => s.id === rec.legs[0]?.strategyId)?.contractAddress ?? "";
  const amountUsd = steps.filter((s) => s.kind !== "approve").reduce((sum, s) => sum + s.amountUsd, 0);
  const amountLabel = steps.filter((s) => s.kind !== "approve").map((s) => fmtAmount(s.amount, s.asset)).join(" + ");
  const builtBy = steps.every((s) => s.builtBy === "ixs-mcp") ? "IXS MCP calldata" : snapshot.replay ? "calldata encoded against the vault ABI (Replay: the IXS MCP builds against the current state only)" : "direct vault calldata (IXS MCP unavailable, non-safety fallback)";

  return {
    id: randomUUID(),
    recommendationId: rec.id,
    walletAddress: user.walletAddress,
    steps,
    summary: {
      from: user.demoMode ? `${user.daoName} Treasury (simulated treasury)` : "Connected wallet",
      fromAddress: user.walletAddress,
      destination,
      destinationAddress: destAddress ? `IXS vault · ${shortAddress(destAddress)}` : "IXS vault",
      action: `Allocate · ${rec.legs.length} deposit${rec.legs.length > 1 ? "s" : ""}`,
      amountUsd,
      amountLabel,
      expectedOutcome: `+${fmtUsd(rec.extraMonthlyUsd)} / mo · ${rec.before.blendedApy.toFixed(1)}% → ${rec.after.blendedApy.toFixed(1)}% APY`,
      riskLevel: minScore >= 85 ? "Low" : minScore >= 70 ? "Medium" : "High",
      riskScores: scores,
      liquidityAfterPct: rec.after.liquidPct,
      liquidityFloorPct: user.liquidityFloorPct,
      rail: `${builtBy} · ${label}`,
      feeUsd: mode === "live" ? Math.round(steps.filter((s) => s.mode === "onchain").length * 0.02 * 100) / 100 : 0,
    },
    createdAt: new Date().toISOString(),
    mode: mode === "live" ? "onchain" : "simulated",
    executionMode: mode,
    rpcKind: rpcKind(chainIds[0] ?? 56),
    label,
    notes,
  };
}
