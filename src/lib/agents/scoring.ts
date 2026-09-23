import { clamp, round } from "@/lib/format";
import type { RiskProfile, VaultPosition } from "@/lib/types";

export interface HealthInput {
  liquidPct: number;
  liquidityFloorPct: number;
  positions: Pick<VaultPosition, "valueUsd" | "riskScore">[];
  maxExposurePct: number;
  maxAssetExposurePct: number;
  idlePct: number;
}

/**
 * Treasury health (0-100): liquidity vs policy floor (30), vault risk quality (25),
 * concentration vs exposure limit (25), idle-capital drag (20).
 */
export function computeHealth(i: HealthInput): number {
  const liquidity = 30 * clamp(i.liquidPct / Math.max(1, i.liquidityFloorPct), 0, 1);
  const deployed = i.positions.reduce((s, p) => s + p.valueUsd, 0);
  const avgRisk = deployed > 0 ? i.positions.reduce((s, p) => s + p.valueUsd * p.riskScore, 0) / deployed : 80;
  const vault = 25 * (avgRisk / 100);
  const ratio = i.maxExposurePct / Math.max(1, i.maxAssetExposurePct);
  const exposure = ratio <= 1 ? 25 - 5 * ratio : 10;
  const idleDrag = 20 * Math.sqrt(clamp(1 - i.idlePct / 100, 0, 1));
  return clamp(Math.round(liquidity + vault + exposure + idleDrag), 0, 100);
}

export function computeOpportunity(i: { idlePct: number; idleDays: number; bestApy: number }): number {
  return clamp(Math.round(i.idlePct * 0.9 + Math.min(30, i.idleDays) * 0.6 + i.bestApy * 2), 0, 100);
}

export function opportunityLabel(score: number) {
  if (score >= 65) return "high · act now";
  if (score >= 40) return "moderate";
  return "low";
}

export function healthLabel(score: number) {
  if (score >= 80) return "Healthy";
  if (score >= 60) return "Watch";
  return "At risk";
}

export function targetAllocationFor(profile: RiskProfile) {
  return profile === "Conservative" ? 55 : profile === "Growth" ? 78 : 68;
}

export function pct(part: number, total: number, decimals = 0) {
  return total > 0 ? round((part / total) * 100, decimals) : 0;
}
