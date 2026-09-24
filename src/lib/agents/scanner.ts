import { LIVE_MODE_MIN_USDC, NATIVE_PRICE_KEY, NATIVE_SYMBOL } from "@/lib/chain/config";
import { ASSET_META, DEMO_ADDRESS, DEMO_HOLDINGS } from "@/lib/demo";
import { round, vaultLabel } from "@/lib/format";
import type {
  DemoState,
  OnchainReadout,
  TreasuryAsset,
  TreasurySnapshot,
  UserProfile,
  VaultPosition,
  VaultStrategy,
} from "@/lib/types";
import { computeHealth, computeOpportunity, opportunityLabel, pct, targetAllocationFor } from "./scoring";

export interface ScanInput {
  user: UserProfile;
  onchain: OnchainReadout;
  prices: Record<string, number>;
  strategies: VaultStrategy[];
  demoState: DemoState;
  now?: Date;
}

interface Holding {
  symbol: string;
  amount: number;
  deployedIn?: string;
  idleDays: number;
  source: "onchain" | "demo";
}

/**
 * Treasury Scanner Agent — reads wallet balances (on-chain) plus the demo treasury profile
 * (hybrid mode), detects idle capital and computes treasury efficiency metrics.
 */
export function scanTreasury(input: ScanInput): TreasurySnapshot {
  const { user, onchain, prices, strategies, demoState } = input;
  const now = input.now ?? new Date();
  const byId = new Map(strategies.map((s) => [s.id, s]));
  const holdings: Holding[] = [];

  // --- demo profile (hybrid mode) ---
  if (user.demoMode) {
    const demo: Holding[] = DEMO_HOLDINGS.map((h) => ({
      symbol: h.symbol,
      amount: h.amount,
      deployedIn: h.deployedIn,
      idleDays: h.idleDays,
      source: "demo",
    }));
    for (const move of demoState.moves) {
      const idle = demo.find((h) => h.symbol === move.asset && !h.deployedIn);
      if (idle) idle.amount = Math.max(0, idle.amount - move.amount);
      const deployedSymbol = move.asset;
      const existing = demo.find((h) => h.deployedIn === move.strategyId);
      if (existing) existing.amount += move.amount;
      else demo.push({ symbol: deployedSymbol, amount: move.amount, deployedIn: move.strategyId, idleDays: 0, source: "demo" });
    }
    holdings.push(...demo.filter((h) => h.amount > 0));
  }

  // --- on-chain (BNB Chain) ---
  const onchainIdleDays = Math.max(1, Math.round((now.getTime() - new Date(user.firstSeenAt).getTime()) / 86_400_000));
  if (onchain.nativeBalance > 0.0005) holdings.push({ symbol: NATIVE_SYMBOL, amount: onchain.nativeBalance, idleDays: onchainIdleDays, source: "onchain" });
  for (const [symbol, amount] of Object.entries(onchain.balances)) {
    if (amount > 1e-9) holdings.push({ symbol, amount, idleDays: onchainIdleDays, source: "onchain" });
  }
  for (const p of onchain.positions) {
    const s = byId.get(p.strategyId);
    if (!s || p.assets <= 0) continue;
    holdings.push({ symbol: s.asset, amount: p.assets, deployedIn: p.strategyId, idleDays: 0, source: "onchain" });
  }

  const priceOf = (symbol: string) => prices[symbol] ?? (symbol === NATIVE_SYMBOL ? (prices[NATIVE_PRICE_KEY] ?? 0) : symbol === "USDC" ? 1 : 0);

  // --- positions per strategy ---
  const positionMap = new Map<string, VaultPosition>();
  for (const h of holdings) {
    if (!h.deployedIn) continue;
    const s = byId.get(h.deployedIn);
    const valueUsd = h.amount * priceOf(h.symbol);
    const p = positionMap.get(h.deployedIn) ?? {
      strategyId: h.deployedIn,
      vaultName: s?.vaultName ?? h.deployedIn,
      asset: s?.asset ?? h.symbol,
      amount: 0,
      valueUsd: 0,
      apy: s?.apy ?? 0,
      riskScore: s?.riskScore ?? 80,
      source: h.source,
    };
    p.amount += h.amount;
    p.valueUsd += valueUsd;
    if (p.source !== h.source) p.source = "demo";
    positionMap.set(h.deployedIn, p);
  }
  const positions = [...positionMap.values()];

  // --- per-asset aggregates ---
  const assetMap = new Map<string, TreasuryAsset>();
  for (const h of holdings) {
    const price = priceOf(h.symbol);
    const value = h.amount * price;
    const meta = ASSET_META[h.symbol] ?? { name: h.symbol, color: "#94A3B8" };
    const a = assetMap.get(h.symbol) ?? {
      symbol: h.symbol,
      name: meta.name,
      balance: 0,
      priceUsd: price,
      valueUsd: 0,
      allocationPct: 0,
      liquidity: "liquid",
      idle: false,
      idleAmount: 0,
      idleUsd: 0,
      deployedAmount: 0,
      deployedUsd: 0,
      idleDays: 0,
      apy: 0,
      source: h.source,
      color: meta.color,
      change30dPct: h.symbol === "BTC" ? 2.1 : h.symbol === NATIVE_SYMBOL ? 1.4 : 0.02,
    };
    a.balance += h.amount;
    a.valueUsd += value;
    if (h.deployedIn) {
      a.deployedAmount += h.amount;
      a.deployedUsd += value;
      a.deployedIn = h.deployedIn;
      const apy = byId.get(h.deployedIn)?.apy ?? 0;
      a.apy = a.deployedUsd > 0 ? (a.apy * (a.deployedUsd - value) + apy * value) / a.deployedUsd : 0;
    } else {
      a.idleAmount += h.amount;
      a.idleUsd += value;
      a.idle = true;
      a.idleDays = Math.max(a.idleDays, h.idleDays);
    }
    if (a.source !== h.source) a.source = "mixed";
    assetMap.set(h.symbol, a);
  }

  const totalUsd = [...assetMap.values()].reduce((s, a) => s + a.valueUsd, 0);
  const assets = [...assetMap.values()]
    .map((a) => {
      a.allocationPct = pct(a.valueUsd, totalUsd);
      a.liquidity = a.idleUsd > 0 && a.deployedUsd === 0 ? "liquid" : a.idleUsd === 0 ? "deployed" : "liquid";
      const where: string[] = [];
      if (a.deployedIn) where.push(vaultLabel(byId.get(a.deployedIn)?.vaultName ?? a.deployedIn));
      if (a.idleUsd > 0) where.push(a.deployedUsd > 0 ? `${round(a.idleAmount, a.symbol === "BTC" ? 2 : 0).toLocaleString("en-US")} ${a.symbol} idle` : "Idle");
      a.note = where.join(" · ");
      return a;
    })
    .sort((x, y) => y.valueUsd - x.valueUsd);

  const idleUsd = assets.reduce((s, a) => s + a.idleUsd, 0);
  const allocatedUsd = positions.reduce((s, p) => s + p.valueUsd, 0);
  const idlePct = pct(idleUsd, totalUsd);
  const allocatedPct = pct(allocatedUsd, totalUsd);
  const blendedApy = totalUsd > 0 ? round(positions.reduce((s, p) => s + p.valueUsd * p.apy, 0) / totalUsd, 1) : 0;
  const earned30dUsd = Math.round(positions.reduce((s, p) => s + (p.valueUsd * p.apy) / 100 / 12, 0));
  const idleDays = assets.filter((a) => a.idle).reduce((m, a) => Math.max(m, a.idleDays), 0);
  const maxExposure = assets.reduce(
    (m, a) => (a.allocationPct > m.pct ? { symbol: a.symbol, pct: a.allocationPct } : m),
    { symbol: "—", pct: 0 },
  );
  const healthScore = computeHealth({
    liquidPct: idlePct,
    liquidityFloorPct: user.liquidityFloorPct,
    positions,
    maxExposurePct: maxExposure.pct,
    maxAssetExposurePct: user.maxAssetExposurePct,
    idlePct,
  });
  const stableSymbol = strategies.find((s) => s.executable)?.asset ?? "USDC";
  const executionMode: TreasurySnapshot["executionMode"] = user.walletAddress.toLowerCase() !== DEMO_ADDRESS && (onchain.balances[stableSymbol] ?? 0) >= LIVE_MODE_MIN_USDC ? "live" : "simulated";
  const bestApy = strategies.filter((s) => s.apy != null && s.status === "active").reduce((m, s) => Math.max(m, s.apy ?? 0), 0);
  const opportunityScore = totalUsd > 0 ? computeOpportunity({ idlePct, idleDays, bestApy }) : 0;

  return {
    walletAddress: user.walletAddress,
    chainId: onchain.chainId,
    scannedAt: now.toISOString(),
    totalUsd: Math.round(totalUsd),
    idleUsd: Math.round(idleUsd),
    idlePct,
    idleDays,
    liquidPct: idlePct,
    liquidUsd: Math.round(idleUsd),
    allocatedPct,
    allocatedUsd: Math.round(allocatedUsd),
    blendedApy,
    earned30dUsd,
    healthScore,
    opportunityScore,
    opportunityLabel: opportunityLabel(opportunityScore),
    runwayMonths: user.monthlyBurnUsd > 0 ? round(idleUsd / user.monthlyBurnUsd, 1) : 0,
    assets,
    positions,
    onchain,
    prices,
    demoMode: user.demoMode,
    maxExposure,
    targetAllocationPct: targetAllocationFor(user.riskProfile),
    executionMode,
  };
}
