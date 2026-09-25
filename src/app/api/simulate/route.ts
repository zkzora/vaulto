import { parseUnits } from "viem";
import { z } from "zod";
import { addressSchema, bad, handle } from "@/lib/api-utils";
import { rpcKind } from "@/lib/chain/client";
import { MIN_DEPOSIT_USDC, modeLabel } from "@/lib/chain/config";
import { simulateDepositSteps, simulateRedeem } from "@/lib/chain/simulate";
import { buildDepositSteps, getStrategies } from "@/lib/ixs/client";
import { buildRedeemRequest } from "@/lib/ixs/mcp";
import { collectEvidence } from "@/lib/evidence";
import { getReplay } from "@/lib/replay";
import { runPreflight } from "@/lib/ixs/preflight";
import { findRegistryVault, getRegistry } from "@/lib/ixs/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const body = z.object({
  address: addressSchema,
  strategyId: z.string().min(1),
  amount: z.number().positive().optional(),
  action: z.enum(["deposit", "redeem"]).optional().default("deposit"),
  /** Shares to redeem (asset-denominated `amount` is converted at the current price when omitted). */
  shares: z.number().positive().optional(),
});

/**
 * POST /api/simulate { address, strategyId, amount? } — "Simulate on <chain> mainnet" for one vault, from any wallet:
 * 1. pre-flight (limit, NAV age, minimum, MCP probe, eligibility, cutoff);
 * 2. when the verdict is ALLOCATE, approve + deposit calldata from the IXS MCP;
 * 3. eth_call with a state override for the wallet's balance and allowance → expected shares or revert reason.
 * A DEFER / REJECT verdict returns the checks and builds nothing (Vaulto policy: never build when limit / NAV fail).
 */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "invalid body");
  const { address, strategyId } = parsed.data;
  const amount = parsed.data.amount ?? MIN_DEPOSIT_USDC;
  const input = parsed.data;
  return handle(async () => {
    const { result, evidence } = await collectEvidence(run);
    return { ...result, evidence };
  });

  async function run() {
    const [{ strategies }, registry] = await Promise.all([getStrategies(), getRegistry()]);
    const strategy = strategies.find((s) => s.id === strategyId);
    if (!strategy) throw new Error("unknown strategy");
    if (!strategy.executable || !strategy.contractAddress || !strategy.assetAddress || strategy.assetDecimals == null) throw new Error(`${strategy.vaultName} has no deployed vault to simulate against`);
    const rv = findRegistryVault(registry, strategy.routeId);
    if (!rv) throw new Error("vault not in the registry");
    const replay = await getReplay();
    const label = replay ? replay.label : modeLabel("simulated", strategy.chainId, rpcKind(strategy.chainId));

    if (input.action === "redeem") {
      const shareDecimals = strategy.shareDecimals ?? 18;
      const sharesNum = input.shares ?? (rv.sharePrice ? amount / rv.sharePrice : amount);
      const shareUnits = parseUnits(sharesNum.toFixed(Math.min(shareDecimals, 12)), shareDecimals);
      const plan = await buildRedeemRequest(strategy.routeId!, address, shareUnits);
      const st = plan.steps![0];
      const sim = await simulateRedeem({
        chainId: strategy.chainId,
        owner: address as `0x${string}`,
        vault: strategy.contractAddress as `0x${string}`,
        step: { to: st.tx.to as `0x${string}`, data: st.tx.data as `0x${string}`, value: st.tx.value },
        shares: shareUnits,
        shareDecimals,
        shareSymbol: strategy.shareSymbol ?? "shares",
        assetDecimals: strategy.assetDecimals,
        assetSymbol: strategy.asset,
      });
      // amount: USDC value of the shares before the fee (gross), so the request and the response agree.
      const grossUsd = sim.grossAssets ?? (rv.sharePrice ? Number((sharesNum * rv.sharePrice).toFixed(4)) : null);
      return { label, strategyId, action: "redeem" as const, chainId: strategy.chainId, asset: strategy.asset, amount: grossUsd ?? amount, shares: sharesNum, builtBy: "ixs-mcp" as const, settlement: plan.settlement, mcpDescription: st.description, minRedeemUsd: rv.redeem.minAssetsUsd, feeBps: rv.redeem.feeBps, redeem: sim, steps: [{ index: 0, kind: "requestRedeem", to: st.tx.to, data: st.tx.data, builtBy: "ixs-mcp" }], verdict: sim.ok ? ("allocate" as const) : ("reject" as const), preflight: null };
    }

    const preflight = await runPreflight(rv, address, amount);
    if (preflight.verdict !== "allocate") {
      return { label, strategyId, amount, asset: strategy.asset, chainId: strategy.chainId, preflight, verdict: preflight.verdict, builtBy: null, steps: [], note: preflight.verdict === "defer" ? "Temporarily paused — waiting NAV refresh. Vaulto policy: no calldata is built while the deposit limit is 0 or the NAV is stale (IXS stated on 24 Sep 2026 that a 0 limit relates to NAV staleness)." : "Rejected by pre-flight: nothing is built." };
    }
    const built = await buildDepositSteps(strategy, address, amount, { preflightOk: true, simulation: true });
    const steps = built.steps.map((s, index) => ({ ...s, index, mode: "simulated" as const, amountUsd: Math.round(s.amount), label }));
    const sims = await simulateDepositSteps({
      chainId: strategy.chainId,
      owner: address as `0x${string}`,
      steps,
      asset: { address: strategy.assetAddress as `0x${string}`, decimals: strategy.assetDecimals, symbol: strategy.asset },
      vault: strategy.contractAddress as `0x${string}`,
      amountUnits: parseUnits(amount.toFixed(Math.min(strategy.assetDecimals, 6)), strategy.assetDecimals),
      shareDecimals: strategy.shareDecimals ?? 18,
      shareSymbol: strategy.shareSymbol ?? "shares",
    });
    return {
      label,
      strategyId,
      amount,
      asset: strategy.asset,
      chainId: strategy.chainId,
      preflight,
      verdict: "allocate" as const,
      builtBy: built.builtBy,
      note: built.note,
      steps: steps.map((s) => ({ index: s.index, kind: s.kind, to: s.to, data: s.data, builtBy: s.builtBy, simulation: sims[s.index] })),
    };
  }
}
