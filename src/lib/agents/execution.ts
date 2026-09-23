import { randomUUID } from "node:crypto";
import { buildDepositSteps } from "@/lib/ixs/client";
import { fmtAmount, fmtUsd, shortAddress } from "@/lib/format";
import type { PreparedTransaction, Recommendation, TxStep, UserProfile, VaultStrategy, TreasurySnapshot } from "@/lib/types";

/**
 * Execution Agent — turns an approved recommendation into a transaction workflow.
 * Legs that are executable on the connected network (and covered by real wallet balance)
 * are built as unsigned calldata through the IXS adapter; everything else is a simulated step.
 * Nothing is signed here: the wallet signs in the browser.
 */
export async function prepareTransaction(
  rec: Recommendation,
  strategies: VaultStrategy[],
  user: UserProfile,
  snapshot: TreasurySnapshot,
  opts: { simulate: boolean },
): Promise<PreparedTransaction> {
  const byId = new Map(strategies.map((s) => [s.id, s]));
  const steps: TxStep[] = [];
  let index = 0;

  for (const leg of rec.legs) {
    const s = byId.get(leg.strategyId);
    const price = snapshot.prices[leg.asset] ?? 1;
    const onchainAmount = !opts.simulate && s?.executable && leg.onchainAmount > 0 ? Math.min(leg.onchainAmount, snapshot.onchain.balances[leg.asset] ?? 0) : 0;
    if (s && onchainAmount > 0) {
      const built = await buildDepositSteps(s, user.walletAddress, onchainAmount);
      for (const st of built.steps) {
        steps.push({ ...st, index: index++, mode: "onchain", amountUsd: Math.round(st.amount * price) });
      }
    }
    const remainder = leg.amount - onchainAmount;
    if (remainder > 0) {
      steps.push({
        index: index++,
        kind: s?.settlement === "async-erc7540" ? "requestDeposit" : "deposit",
        strategyId: leg.strategyId,
        vaultName: leg.vaultName,
        to: (s?.contractAddress ?? "0x0000000000000000000000000000000000000000") as `0x${string}`,
        data: "0x",
        value: "0",
        chainId: s?.chainId ?? snapshot.chainId,
        description: `Deposit ${fmtAmount(remainder, leg.asset)} into ${leg.vaultName} (prepared via IXS Agent Rail · simulated)`,
        amount: remainder,
        amountUsd: Math.round(remainder * price),
        asset: leg.asset,
        mode: "simulated",
        builtBy: "simulation",
      });
    }
  }

  const onchainCount = steps.filter((s) => s.mode === "onchain").length;
  const mode: PreparedTransaction["mode"] = onchainCount === 0 ? "simulated" : onchainCount === steps.length ? "onchain" : "hybrid";
  const scores = rec.legs.map((l) => l.riskScore);
  const minScore = Math.min(...scores);
  const destination = rec.legs.map((l) => l.vaultName).join(" + ");
  const destAddress = strategies.find((s) => s.id === rec.legs[0]?.strategyId)?.contractAddress ?? "";

  return {
    id: randomUUID(),
    recommendationId: rec.id,
    walletAddress: user.walletAddress,
    steps,
    summary: {
      from: user.demoMode ? `${user.daoName} Treasury` : "Connected wallet",
      fromAddress: user.walletAddress,
      destination,
      destinationAddress: destAddress ? `IXS Agent Rail · ${shortAddress(destAddress)}` : "IXS Agent Rail",
      action: `Allocate · ${rec.legs.length} deposit${rec.legs.length > 1 ? "s" : ""}`,
      amountUsd: rec.totalUsd,
      amountLabel: rec.legs.map((l) => fmtAmount(l.amount, l.asset)).join(" + "),
      expectedOutcome: `+${fmtUsd(rec.extraMonthlyUsd)} / mo · ${rec.before.blendedApy.toFixed(1)}% → ${rec.after.blendedApy.toFixed(1)}% APY`,
      riskLevel: minScore >= 85 ? "Low" : minScore >= 70 ? "Medium" : "High",
      riskScores: scores,
      liquidityAfterPct: rec.after.liquidPct,
      liquidityFloorPct: user.liquidityFloorPct,
      rail: "IXS Agent Rail · MCP",
      feeUsd: mode === "simulated" ? 0 : Math.round(onchainCount * 0.02 * 100) / 100,
    },
    createdAt: new Date().toISOString(),
    mode,
  };
}
