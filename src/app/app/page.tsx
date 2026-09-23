"use client";

import Link from "next/link";
import { RecommendationCard } from "@/components/dashboard/recommendation-card";
import { AgentActivityList } from "@/components/dashboard/agent-activity";
import { useVaultoAccount } from "@/hooks/use-account";
import { useActivity, useAnalyze, useTreasury } from "@/hooks/use-vaulto";
import { CHAIN_NAME } from "@/lib/chain/config";
import { fmtDate, fmtUsd, greeting, timeAgo } from "@/lib/format";
import { Card, CardTitle, Donut, ErrorState, Pill, Skeleton, Stat, cx } from "@/components/ui";

export default function HomePage() {
  const treasury = useTreasury();
  const activity = useActivity();
  const analyze = useAnalyze();
  const account = useVaultoAccount();

  if (treasury.isError) return <ErrorState message={treasury.error.message} retry={() => treasury.refetch()} />;
  if (!treasury.data) {
    return (
      <div className="grid gap-5">
        <Skeleton className="h-16 max-w-md" />
        <div className="grid gap-5 lg:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  const { user, snapshot, recommendation, strategies } = treasury.data;
  const positionsById = new Map(snapshot.positions.map((p) => [p.strategyId, p]));
  const healthTone = snapshot.healthScore >= 80 ? "green" : snapshot.healthScore >= 60 ? "amber" : "amber";

  return (
    <div className="grid content-start gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-display text-[26px] font-semibold tracking-[-0.02em] text-ink lg:text-[28px]">
            {greeting()}, {user.daoName}
          </div>
          <div className="mt-1 text-[14px] text-muted">
            {fmtDate(snapshot.scannedAt)} · Risk preference: <b className="text-ink">{user.riskProfile}</b>
            {snapshot.onchain.rpcOk ? (
              <span> · {CHAIN_NAME} block {snapshot.onchain.blockNumber?.toLocaleString()}</span>
            ) : (
              <span className="text-amber"> · RPC unavailable, showing cached demo values</span>
            )}
          </div>
        </div>
        <div className="flex gap-2.5">
          <Link href="/app/vaults" className="btn btn-soft">Deposit</Link>
          <button className="btn btn-primary" disabled={analyze.isPending} onClick={() => analyze.mutate()}>
            {analyze.isPending && <span className="spinner" />}
            {analyze.isPending ? "Analyzing…" : "Run analysis"}
          </button>
        </div>
      </div>

      {account.isWallet && (snapshot.onchain.balances.ixUSDC ?? 0) === 0 && snapshot.onchain.positions.length === 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-tint px-4 py-3 text-[13px] text-body">
          <span>
            <b className="text-ink">No IXS test USDC in this wallet yet.</b> Claim gas and ixUSDC from the {CHAIN_NAME} faucet to run a real allocation into the IXS vault.
          </span>
          <Link href="/app/faucet" className="btn btn-primary h-9 text-[13px]">Get test funds</Link>
        </div>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between">
            <div className="eyebrow">Total treasury</div>
            <span className="text-[12px] font-medium text-faint">Scanned {timeAgo(snapshot.scannedAt)}</span>
          </div>
          <div className="mt-2.5 flex flex-wrap items-baseline gap-3.5">
            <span className="font-display text-[40px] font-semibold leading-none tracking-[-0.025em] text-ink lg:text-[48px]">{fmtUsd(snapshot.totalUsd)}</span>
            <span className="text-[15px] font-semibold text-green">+{fmtUsd(Math.round(snapshot.earned30dUsd / 4))} · 7d</span>
          </div>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            <div className="rounded-xl bg-amber-tint px-3.5 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-amber">Idle capital detected</div>
              <div className="mt-0.5 font-display text-[24px] font-semibold leading-none text-amber">{fmtUsd(snapshot.idleUsd)}</div>
              <div className="mt-1 text-[11px] font-medium text-amber">
                {snapshot.idlePct}% of treasury · {snapshot.idleDays} days
              </div>
            </div>
            <div className="rounded-xl bg-tint px-3.5 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-blue-deep">Opportunity score</div>
              <div className="mt-0.5 font-display text-[24px] font-semibold leading-none text-blue-deep">
                {snapshot.opportunityScore}
                <span className="text-[12px] font-semibold">/100</span>
              </div>
              <div className="mt-1 text-[11px] font-medium text-blue-deep">{snapshot.opportunityLabel}</div>
            </div>
          </div>
          <div className="mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Allocated" value={`${snapshot.allocatedPct}%`} sub={`${fmtUsd(snapshot.allocatedUsd, { compact: true })} · ${snapshot.positions.length} IXS vault${snapshot.positions.length === 1 ? "" : "s"}`} />
            <Stat label="Liquid" value={`${snapshot.liquidPct}%`} sub={`floor ${user.liquidityFloorPct}%`} />
            <Stat
              label="Current yield"
              value={
                <>
                  {snapshot.blendedApy.toFixed(1)}%<span className="text-[12px] font-medium text-faint"> APY</span>
                </>
              }
              sub="blended APY"
            />
            <Stat label="Earned 30d" value={fmtUsd(snapshot.earned30dUsd)} sub="realized yield" />
            <Stat
              label="Health"
              tone={healthTone}
              value={
                <>
                  {snapshot.healthScore}
                  <span className="text-[12px] font-medium">/100</span>
                </>
              }
              sub={snapshot.healthScore >= 80 ? "Healthy" : snapshot.healthScore >= 60 ? "Watch" : "At risk"}
            />
          </div>
        </Card>
        <RecommendationCard rec={recommendation} snapshot={snapshot} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_1.3fr_1fr]">
        <Card>
          <CardTitle action={<Link href="/app/portfolio" className="text-[13px] font-semibold text-blue-deep">Portfolio →</Link>}>Allocation</CardTitle>
          <div className="mt-5 flex items-center gap-5">
            <Donut
              segments={snapshot.assets.map((a) => ({ pct: a.allocationPct, color: a.color }))}
              center={
                <>
                  <span className="text-[11px] font-semibold text-muted">Assets</span>
                  <span className="font-display text-[20px] font-semibold text-ink">{snapshot.assets.length}</span>
                </>
              }
            />
            <div className="grid flex-1 gap-2.5 text-[13px] font-medium text-body">
              {snapshot.assets.map((a) => (
                <div key={a.symbol} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: a.color }} />
                  {a.symbol}
                  <span className="ml-auto font-semibold text-ink">{a.allocationPct}%</span>
                </div>
              ))}
              {!snapshot.assets.length && <div className="text-muted">No assets found on {CHAIN_NAME}.</div>}
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle action={<Link href="/app/vaults" className="text-[13px] font-semibold text-blue-deep">IXS Strategies →</Link>}>IXS strategy health</CardTitle>
          <div className="mt-4 grid gap-2.5">
            {strategies
              .filter((s) => s.source === "catalog")
              .map((s) => {
                const p = positionsById.get(s.id);
                return (
                  <div key={s.id} className={cx("grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl px-4 py-3.5", s.tag === "primary" ? "border-[1.5px] border-blue bg-tint-2" : "border border-line")}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                        {s.vaultName}
                        {s.tag === "primary" && <span className="pill h-[18px] bg-blue px-1.5 text-[10px] tracking-[0.04em] text-white">PRIMARY</span>}
                      </div>
                      <div className="mt-0.5 text-[12px] leading-[1.5] text-muted">
                        {p ? `${p.amount.toLocaleString("en-US", { maximumFractionDigits: p.asset === "BTC" ? 2 : 0 })} ${p.asset === "USDC" ? "USDC" : p.asset} allocated · ${fmtUsd(p.valueUsd)} · ${s.liquidity.toLowerCase()}` : `${s.description.split(".")[0]}.`}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-display text-[16px] font-semibold text-ink">{s.availability === "announced" ? "4–12%" : s.apy != null ? `${s.apyEstimated ? "~" : ""}${s.apy}%` : "—"}</div>
                      <div className="mt-1 flex justify-end gap-1.5">
                        <Pill tone="green" className="h-5 px-[7px] text-[10px]">Risk {s.riskScore}</Pill>
                        <Pill tone={p ? (s.tag === "primary" ? "blue" : "muted") : "muted"} className="h-5 px-[7px] text-[10px]">
                          {s.availability === "announced" ? "Announced · not deployable" : p ? `Active${s.tag === "secondary" ? " · Secondary" : ""}` : s.requiresWhitelist ? "Eligibility check" : "Available"}
                        </Pill>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </Card>

        <Card>
          <CardTitle action={<Link href="/app/activity" className="text-[13px] font-semibold text-blue-deep">All →</Link>}>Agent activity</CardTitle>
          <div className="mt-2">{activity.data ? <AgentActivityList logs={activity.data.logs} limit={6} /> : <Skeleton className="h-40" />}</div>
        </Card>
      </div>
    </div>
  );
}
