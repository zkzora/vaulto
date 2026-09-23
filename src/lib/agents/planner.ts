import { clamp, round } from "@/lib/format";
import type { AllocationLeg, Metrics, TreasurySnapshot, UserProfile } from "@/lib/types";
import { computeHealth, pct } from "./scoring";
import type { Candidate } from "./finder";

export interface Plan {
  legs: AllocationLeg[];
  before: Metrics;
  after: Metrics;
  totalUsd: number;
  extraMonthlyUsd: number;
  liquidityAfterPct: number;
  txCount: number;
  feeUsd: number;
}

function metricsFor(snapshot: TreasurySnapshot, user: UserProfile, legs: AllocationLeg[]): Metrics {
  const deployUsd = legs.reduce((s, l) => s + l.amountUsd, 0);
  const idleUsd = snapshot.idleUsd - deployUsd;
  const idlePct = pct(idleUsd, snapshot.totalUsd);
  const positions = snapshot.positions.map((p) => ({ ...p }));
  for (const l of legs) {
    const p = positions.find((x) => x.strategyId === l.strategyId);
    if (p) p.valueUsd += l.amountUsd;
    else positions.push({ strategyId: l.strategyId, vaultName: l.vaultName, asset: l.asset, amount: l.amount, valueUsd: l.amountUsd, apy: l.apy, riskScore: l.riskScore, source: "demo" });
  }
  const blendedApy = snapshot.totalUsd > 0 ? round(positions.reduce((s, p) => s + p.valueUsd * p.apy, 0) / snapshot.totalUsd, 1) : 0;
  const perStrategyPct: Record<string, number> = {};
  for (const p of positions) perStrategyPct[p.strategyId] = pct(p.valueUsd, snapshot.totalUsd);
  return {
    liquidPct: idlePct,
    idlePct,
    blendedApy,
    allocatedPct: pct(positions.reduce((s, p) => s + p.valueUsd, 0), snapshot.totalUsd),
    healthScore: computeHealth({
      liquidPct: idlePct,
      liquidityFloorPct: user.liquidityFloorPct,
      positions,
      maxExposurePct: snapshot.maxExposure.pct,
      maxAssetExposurePct: user.maxAssetExposurePct,
      idlePct,
    }),
    perStrategyPct,
  };
}

/**
 * Allocation Planner Agent — sizes deposits so the treasury stays above the liquidity floor
 * (plus a one-point buffer) and keeps at least two months of burn liquid. Never sells assets.
 */
export function planAllocation(snapshot: TreasurySnapshot, approved: Candidate[], user: UserProfile): Plan | null {
  if (!approved.length || snapshot.totalUsd <= 0) return null;
  const floorUsd = snapshot.totalUsd * ((user.liquidityFloorPct + 1) / 100);
  // Two months of burn can raise the liquid reserve above the floor, but by at most 10 points of
  // treasury, so a large burn setting never blocks a small treasury from deploying anything.
  const burnBuffer = user.monthlyBurnUsd * 2;
  const bufferCapUsd = snapshot.totalUsd * Math.min(0.6, (user.liquidityFloorPct + 11) / 100);
  const keepLiquid = clamp(burnBuffer, floorUsd, Math.max(floorUsd, bufferCapUsd));
  let budget = Math.max(0, snapshot.idleUsd - keepLiquid);
  if (budget < 50) return null;

  const totalIdle = approved.reduce((s, c) => s + c.idleUsd, 0);
  const legs: AllocationLeg[] = [];
  for (const c of approved) {
    const share = totalIdle > 0 ? c.idleUsd / totalIdle : 0;
    let usd = Math.min(c.idleUsd, budget * share);
    const price = snapshot.prices[c.asset] ?? 1;
    let amount = usd / price;
    if (c.asset === "BTC") amount = Math.floor(amount * 100) / 100;
    else if (c.asset === "ETH") amount = Math.floor(amount * 1000) / 1000;
    else amount = usd >= 10_000 ? Math.floor(amount / 1000) * 1000 : Math.floor(amount * 100) / 100;
    usd = amount * price;
    if (usd < 10) continue;
    const onchainIdle = c.strategy.executable ? Math.min(snapshot.onchain.balances[c.asset] ?? 0, amount) : 0;
    legs.push({
      strategyId: c.strategy.id,
      vaultName: c.strategy.vaultName,
      asset: c.asset,
      amount: round(amount, 6),
      amountUsd: Math.round(usd),
      apy: c.strategy.apy ?? 0,
      riskScore: c.strategy.riskScore,
      executable: c.strategy.executable,
      onchainAmount: round(onchainIdle, 6),
    });
  }
  if (!legs.length) return null;
  budget = legs.reduce((s, l) => s + l.amountUsd, 0);

  const before = metricsFor(snapshot, user, []);
  const after = metricsFor(snapshot, user, legs);
  const extraMonthlyUsd = Math.round(legs.reduce((s, l) => s + (l.amountUsd * l.apy) / 100 / 12, 0));
  const txCount = legs.reduce((s, l) => s + (l.executable ? 2 : 1), 0);
  return {
    legs,
    before,
    after,
    totalUsd: Math.round(budget),
    extraMonthlyUsd,
    liquidityAfterPct: clamp(after.liquidPct, 0, 100),
    txCount,
    feeUsd: round(0.02 * txCount, 2),
  };
}
