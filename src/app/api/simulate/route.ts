import { parseUnits } from "viem";
import { z } from "zod";
import { addressSchema, bad, handle } from "@/lib/api-utils";
import { rpcKind } from "@/lib/chain/client";
import { MIN_DEPOSIT_USDC, modeLabel } from "@/lib/chain/config";
import { simulateDepositSteps } from "@/lib/chain/simulate";
import { buildDepositSteps, getStrategies } from "@/lib/ixs/client";
import { runPreflight } from "@/lib/ixs/preflight";
import { findRegistryVault, getRegistry } from "@/lib/ixs/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const body = z.object({
  address: addressSchema,
  strategyId: z.string().min(1),
  amount: z.number().positive().optional(),
});

/**
 * POST /api/simulate { address, strategyId, amount? } — "Simulate on <chain> mainnet" for one vault, from any wallet:
 * 1. pre-flight (limit, NAV age, minimum, MCP probe, eligibility, cutoff);
 * 2. when the verdict is ALLOCATE, approve + deposit calldata from the IXS MCP;
 * 3. eth_call with a state override for the wallet's balance and allowance → expected shares or revert reason.
 * A DEFER / REJECT verdict returns the checks and builds nothing (per IXS: never build when limit / NAV fail).
 */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "invalid body");
  const { address, strategyId } = parsed.data;
  const amount = parsed.data.amount ?? MIN_DEPOSIT_USDC;
  return handle(async () => {
    const [{ strategies }, registry] = await Promise.all([getStrategies(), getRegistry()]);
    const strategy = strategies.find((s) => s.id === strategyId);
    if (!strategy) throw new Error("unknown strategy");
    if (!strategy.executable || !strategy.contractAddress || !strategy.assetAddress || strategy.assetDecimals == null) throw new Error(`${strategy.vaultName} has no deployed vault to simulate against`);
    const rv = findRegistryVault(registry, strategy.routeId);
    if (!rv) throw new Error("vault not in the registry");
    const label = modeLabel("simulated", strategy.chainId, rpcKind(strategy.chainId));
    const preflight = await runPreflight(rv, address, amount);
    if (preflight.verdict !== "allocate") {
      return { label, strategyId, amount, asset: strategy.asset, chainId: strategy.chainId, preflight, verdict: preflight.verdict, builtBy: null, steps: [], note: preflight.verdict === "defer" ? "Temporarily paused — waiting NAV refresh: per IXS (24 Sep 2026) Vaulto does not build calldata while the deposit limit is 0 or the NAV is stale." : "Rejected by pre-flight: nothing is built." };
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
  });
}
