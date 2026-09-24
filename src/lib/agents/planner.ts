import { MIN_DEPOSIT_USDC } from "@/lib/chain/config";
import { clamp, round } from "@/lib/format";
import type { AllocationLeg, Metrics, TreasurySnapshot, UserProfile } from "@/lib/types";
import { computeHealth, pct } from "./scoring";
import type { Candidate } from "./finder";

const STABLE_ASSETS = new Set(["USDC"]);

export interface LegCap {
  strategyId: string;
  vaultName: string;
  chainId: number;
  chainName: string;
  asset: string;
  /** maxDeposit() for the wallet, null = unlimited. */
  depositLimitUsd: number | null;
  priceUsd: number;
  apy: number;
  riskScore: number;
  /** Largest amount (asset units) policy allows into this strategy. */
  maxAmount: number;
  maxUsd: number;
  /** Why the cap is below the idle balance, if it is. */
  capNote?: string;
}

export interface Constraints {
  totalUsd: number;
  idleUsd: number;
  /** USD that must stay liquid after the allocation (policy floor + burn buffer). */
  keepLiquidUsd: number;
  /** USD available to deploy across all legs. */
  budgetUsd: number;
  /** Stablecoin runway reserve that never leaves the wallet (two months of burn). */
  stableReserveUsd: number;
  /** IXS minimum deposit per leg (USD). */
  minDepositUsd: number;
  caps: LegCap[];
}

export interface LegInput {
  strategyId: string;
  amount: number;
}

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

function roundAmount(asset: string, amount: number, usd: number) {
  if (asset === "BTC") return Math.floor(amount * 100) / 100;
  if (asset === "ETH" || asset === "BNB") return Math.floor(amount * 1000) / 1000;
  return usd >= 10_000 ? Math.floor(amount / 1000) * 1000 : Math.floor(amount * 100) / 100;
}

/**
 * Allocation Planner Agent, step 1 — policy constraints every allocation must respect:
 * liquidity floor (+1pt), two months of burn kept liquid (at most 10 pts above the floor), and a
 * stablecoin runway reserve. The decision itself is made by SERV reasoning within these caps.
 */
export function planConstraints(snapshot: TreasurySnapshot, approved: Candidate[], user: UserProfile): Constraints | null {
  if (!approved.length || snapshot.totalUsd <= 0) return null;
  const floorUsd = snapshot.totalUsd * ((user.liquidityFloorPct + 1) / 100);
  const burnBuffer = user.monthlyBurnUsd * 2;
  const bufferCapUsd = snapshot.totalUsd * Math.min(0.6, (user.liquidityFloorPct + 11) / 100);
  const keepLiquidUsd = clamp(burnBuffer, floorUsd, Math.max(floorUsd, bufferCapUsd));
  const budgetUsd = Math.max(0, snapshot.idleUsd - keepLiquidUsd);
  if (budgetUsd < 50) return null;
  const stableReserveUsd = user.monthlyBurnUsd > 0 ? burnBuffer : 0;

  const caps: LegCap[] = [];
  for (const c of approved) {
    const price = snapshot.prices[c.asset] ?? 1;
    let maxUsd = Math.min(c.idleUsd, budgetUsd);
    let capNote: string | undefined;
    if (STABLE_ASSETS.has(c.asset) && stableReserveUsd > 0) {
      const afterReserve = Math.max(0, c.idleUsd - stableReserveUsd);
      if (afterReserve < maxUsd) {
        maxUsd = afterReserve;
        capNote = `keeps two months of burn (${Math.round(stableReserveUsd).toLocaleString("en-US")} USD) in stablecoins`;
      }
    }
    const limit = c.strategy.preflight ? (c.strategy.preflight.depositLimitUnlimited ? null : c.strategy.preflight.depositLimitUsd) : (c.strategy.depositLimitUsd ?? null);
    if (limit != null && limit < maxUsd) {
      maxUsd = limit;
      capNote = `IXS deposit limit ${limit.toLocaleString("en-US")} ${c.asset} (maxDeposit on-chain)`;
    }
    const maxAmount = roundAmount(c.asset, maxUsd / price, maxUsd);
    if (maxAmount * price < (c.strategy.terms?.minDepositUsd ?? 10)) continue;
    caps.push({ strategyId: c.strategy.id, vaultName: c.strategy.vaultName, chainId: c.strategy.chainId, chainName: c.strategy.chainName, asset: c.asset, depositLimitUsd: limit, priceUsd: price, apy: c.strategy.apy ?? 0, riskScore: c.strategy.riskScore, maxAmount, maxUsd: Math.round(maxAmount * price), capNote });
  }
  if (!caps.length) return null;
  return { totalUsd: snapshot.totalUsd, idleUsd: snapshot.idleUsd, keepLiquidUsd: Math.round(keepLiquidUsd), budgetUsd: Math.round(budgetUsd), stableReserveUsd: Math.round(stableReserveUsd), minDepositUsd: MIN_DEPOSIT_USDC, caps };
}

/** Deterministic sizing used when SERV reasoning is unavailable: fill caps proportionally to idle size. */
export function localLegs(constraints: Constraints): LegInput[] {
  const totalCap = constraints.caps.reduce((s, c) => s + c.maxUsd, 0);
  return constraints.caps.map((c) => {
    const share = totalCap > 0 ? c.maxUsd / totalCap : 0;
    const usd = Math.min(c.maxUsd, constraints.budgetUsd * share);
    return { strategyId: c.strategyId, amount: roundAmount(c.asset, usd / c.priceUsd, usd) };
  });
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
 * Allocation Planner Agent, step 2 — validates a decision (from SERV reasoning or the local fallback)
 * against the constraints: unknown strategies are dropped, amounts are clamped to their caps, the total
 * is scaled down to the budget. Returns the plan with before/after metrics, or null when nothing survives.
 */
export function buildPlan(snapshot: TreasurySnapshot, approved: Candidate[], user: UserProfile, constraints: Constraints, input: LegInput[]): Plan | null {
  const byId = new Map(approved.map((c) => [c.strategy.id, c]));
  let legs: AllocationLeg[] = [];
  for (const li of input) {
    const cap = constraints.caps.find((c) => c.strategyId === li.strategyId);
    const cand = byId.get(li.strategyId);
    if (!cap || !cand || !(li.amount > 0)) continue;
    const amount = roundAmount(cap.asset, Math.min(li.amount, cap.maxAmount), Math.min(li.amount, cap.maxAmount) * cap.priceUsd);
    const usd = amount * cap.priceUsd;
    if (usd < (cand.strategy.terms?.minDepositUsd ?? 10)) continue;
    legs.push({
      strategyId: cap.strategyId,
      vaultName: cap.vaultName,
      asset: cap.asset,
      amount: round(amount, 6),
      amountUsd: Math.round(usd),
      apy: cap.apy,
      riskScore: cap.riskScore,
      executable: cand.strategy.executable,
      onchainAmount: cand.strategy.executable ? round(Math.min(snapshot.onchain.byChain?.[cap.chainId]?.balances[cap.asset] ?? snapshot.onchain.balances[cap.asset] ?? 0, amount), 6) : 0,
      chainId: cap.chainId,
      chainName: cap.chainName,
    });
  }
  const sum = legs.reduce((s, l) => s + l.amountUsd, 0);
  if (sum > constraints.budgetUsd && sum > 0) {
    const k = constraints.budgetUsd / sum;
    legs = legs
      .map((l) => {
        const amount = roundAmount(l.asset, l.amount * k, l.amountUsd * k);
        return { ...l, amount: round(amount, 6), amountUsd: Math.round(amount * (l.amountUsd / l.amount)), onchainAmount: round(Math.min(l.onchainAmount, amount), 6) };
      })
      .filter((l) => l.amountUsd >= (byId.get(l.strategyId)?.strategy.terms?.minDepositUsd ?? 10));
  }
  if (!legs.length) return null;

  const before = metricsFor(snapshot, user, []);
  const after = metricsFor(snapshot, user, legs);
  const totalUsd = legs.reduce((s, l) => s + l.amountUsd, 0);
  const extraMonthlyUsd = Math.round(legs.reduce((s, l) => s + (l.amountUsd * l.apy) / 100 / 12, 0));
  const txCount = legs.reduce((s, l) => s + (l.executable ? 2 : 1), 0);
  return { legs, before, after, totalUsd: Math.round(totalUsd), extraMonthlyUsd, liquidityAfterPct: clamp(after.liquidPct, 0, 100), txCount, feeUsd: round(0.002 * txCount, 3) };
}
