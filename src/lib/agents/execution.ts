import { randomUUID } from "node:crypto";
import { parseUnits } from "viem";
import { simulateDepositSteps } from "@/lib/chain/simulate";
import { MODE_LABEL, type ExecutionMode } from "@/lib/chain/config";
import { buildDepositSteps } from "@/lib/ixs/client";
import { fmtAmount, fmtUsd, shortAddress } from "@/lib/format";
import type { PreparedTransaction, Recommendation, TxStep, UserProfile, VaultStrategy, TreasurySnapshot } from "@/lib/types";

/**
 * Execution Agent — turns an approved recommendation into a transaction workflow against the real IXS vault.
 *
 * - Every leg is built as approve + deposit calldata by the IXS MCP (asset units read from the contract).
 * - Live mode (wallet holds >= 100 USDC): the steps are returned unsigned for the wallet to sign on BNB Chain.
 * - Simulated mode: the same calldata is run through eth_call with a state override (balance + allowance)
 *   against the vault on BNB mainnet (or a local Anvil fork), and the expected shares / revert reason are
 *   attached to each step. Nothing is signed here and nothing moves.
 */
export async function prepareTransaction(
  rec: Recommendation,
  strategies: VaultStrategy[],
  user: UserProfile,
  snapshot: TreasurySnapshot,
  opts: { forceSimulated: boolean },
): Promise<PreparedTransaction> {
  const byId = new Map(strategies.map((s) => [s.id, s]));
  const mode: ExecutionMode = opts.forceSimulated ? "simulated" : snapshot.executionMode;
  const rpcKind = snapshot.onchain.rpcKind;
  const label = mode === "live" ? MODE_LABEL.live : rpcKind === "fork" ? MODE_LABEL.fork : MODE_LABEL.simulated;
  const steps: TxStep[] = [];
  const notes: string[] = [];
  let index = 0;

  for (const leg of rec.legs) {
    const s = byId.get(leg.strategyId);
    if (!s?.executable || !s.contractAddress || !s.assetAddress || s.assetDecimals == null) {
      notes.push(`${leg.vaultName}: not executable (no live IXS vault)`);
      continue;
    }
    const price = snapshot.prices[leg.asset] ?? 1;
    const balance = snapshot.onchain.balances[leg.asset] ?? 0;
    // Live mode can only deposit what the wallet really holds; simulation runs the full recommended amount.
    const amount = mode === "live" ? Math.min(leg.amount, balance) : leg.amount;
    if (amount <= 0) {
      notes.push(`${leg.vaultName}: wallet holds no ${leg.asset}`);
      continue;
    }
    const built = await buildDepositSteps(s, user.walletAddress, amount, { allowLocalFallback: mode === "simulated" });
    if (built.note) notes.push(built.note);
    const legSteps: TxStep[] = built.steps.map((st) => ({ ...st, index: index++, mode: mode === "live" ? "onchain" : "simulated", amountUsd: Math.round(st.amount * price), note: built.note }));

    if (mode === "simulated") {
      const units = parseUnits(amount.toFixed(Math.min(s.assetDecimals, 6)), s.assetDecimals);
      try {
        const sims = await simulateDepositSteps({
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

  const scores = rec.legs.map((l) => l.riskScore);
  const minScore = Math.min(...scores);
  const destination = rec.legs.map((l) => l.vaultName).join(" + ");
  const destAddress = strategies.find((s) => s.id === rec.legs[0]?.strategyId)?.contractAddress ?? "";
  const amountUsd = steps.filter((s) => s.kind !== "approve").reduce((sum, s) => sum + s.amountUsd, 0);
  const amountLabel = steps.filter((s) => s.kind !== "approve").map((s) => fmtAmount(s.amount, s.asset)).join(" + ");
  const builtBy = steps.every((s) => s.builtBy === "ixs-mcp") ? "IXS MCP calldata" : "ERC-4626 calldata (IXS MCP unreachable)";

  return {
    id: randomUUID(),
    recommendationId: rec.id,
    walletAddress: user.walletAddress,
    steps,
    summary: {
      from: user.demoMode ? `${user.daoName} Treasury` : "Connected wallet",
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
      feeUsd: mode === "live" ? Math.round(steps.length * 0.02 * 100) / 100 : 0,
    },
    createdAt: new Date().toISOString(),
    mode: mode === "live" ? "onchain" : "simulated",
    executionMode: mode,
    rpcKind,
    label,
    notes,
  };
}
