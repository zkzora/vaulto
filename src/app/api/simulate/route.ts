import { parseUnits } from "viem";
import { z } from "zod";
import { addressSchema, bad, handle } from "@/lib/api-utils";
import { RPC_KIND } from "@/lib/chain/client";
import { MIN_DEPOSIT_USDC, MODE_LABEL } from "@/lib/chain/config";
import { simulateDepositSteps } from "@/lib/chain/simulate";
import { buildDepositSteps, getStrategies } from "@/lib/ixs/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const body = z.object({
  address: addressSchema,
  strategyId: z.string().min(1),
  amount: z.number().positive().optional(),
});

/**
 * POST /api/simulate { address, strategyId, amount? } — "Simulate on BNB mainnet" for one vault:
 * builds approve + deposit calldata (IXS MCP, local ERC-4626 encoder if the MCP refuses) and runs it through
 * eth_call with a state override for the wallet's balance and allowance. Returns expected shares or the revert
 * reason per step. Nothing is sent.
 */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "invalid body");
  const { address, strategyId } = parsed.data;
  const amount = parsed.data.amount ?? MIN_DEPOSIT_USDC;
  return handle(async () => {
    const { strategies } = await getStrategies();
    const strategy = strategies.find((s) => s.id === strategyId);
    if (!strategy) throw new Error("unknown strategy");
    if (!strategy.executable || !strategy.contractAddress || !strategy.assetAddress || strategy.assetDecimals == null) throw new Error(`${strategy.vaultName} has no deployed vault to simulate against`);
    const label = RPC_KIND === "fork" ? MODE_LABEL.fork : MODE_LABEL.simulated;
    const built = await buildDepositSteps(strategy, address, amount, { allowLocalFallback: true }).catch((e) => ({ error: e instanceof Error ? e.message : "could not build calldata" }));
    if ("error" in built) {
      // The IXS MCP refused to build (limit 0 for a non-whitelisted wallet, paused vault, …): that is the verdict.
      return { label, strategyId, amount, asset: strategy.asset, builtBy: "ixs-mcp", mcpRefused: built.error, steps: [] };
    }
    const steps = built.steps.map((s, index) => ({ ...s, index, mode: "simulated" as const, amountUsd: Math.round(s.amount) }));
    const sims = await simulateDepositSteps({
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
      builtBy: built.builtBy,
      note: built.note,
      steps: steps.map((s) => ({ index: s.index, kind: s.kind, to: s.to, data: s.data, builtBy: s.builtBy, simulation: sims[s.index] })),
    };
  });
}
