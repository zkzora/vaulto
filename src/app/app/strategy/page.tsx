"use client";

import Link from "next/link";
import { AnalysisProgress } from "@/components/dashboard/recommendation-card";
import { useTxn } from "@/components/txn/txn-provider";
import { useAnalyze, useRecommendationStatus, useTreasury } from "@/hooks/use-vaulto";
import { fmtAmount, fmtTime, fmtUsd, vaultLabel } from "@/lib/format";
import { BeforeAfterBar, Card, CardTitle, EmptyState, ErrorState, OpenServBadge, Pill, Skeleton, Stat, cx } from "@/components/ui";

export default function StrategyPage() {
  const treasury = useTreasury();
  const analyze = useAnalyze();
  const status = useRecommendationStatus();
  const txn = useTxn();

  if (treasury.isError) return <ErrorState message={treasury.error.message} retry={() => treasury.refetch()} />;
  if (!treasury.data) return <Skeleton className="h-96" />;

  const { user, snapshot, recommendation: rec, strategies } = treasury.data;

  if (analyze.isPending) {
    return (
      <Card accent className="mx-auto max-w-xl">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-blue-deep">OpenServ reasoning</span>
          <OpenServBadge />
        </div>
        <div className="mt-3 font-display text-[20px] font-semibold text-ink">Running the multi-agent pipeline</div>
        <AnalysisProgress />
      </Card>
    );
  }

  if (!rec || !rec.legs.length) {
    return (
      <EmptyState
        title={rec?.headline ?? "No strategy proposed yet"}
        body={rec?.summary ?? "Run an analysis and OpenServ will scan the treasury, evaluate IXS RWA strategies against your policy and draft an allocation for your approval."}
        action={
          <button className="btn btn-primary" onClick={() => analyze.mutate()}>
            Run analysis
          </button>
        }
      />
    );
  }

  const byId = new Map(strategies.map((s) => [s.id, s]));
  const idle = snapshot.assets.filter((a) => a.idle);
  const closed = rec.status === "rejected" || rec.status === "dismissed";
  // Stepper: proposed → scan + reasoning done, allocation under review; approved → awaiting signature; executed → all done.
  const stepDone = (i: number) => rec.status === "executed" || (rec.status === "approved" ? i <= 2 : closed ? i <= 2 : i <= 1);
  const stepCurrent = (i: number) => !closed && rec.status !== "executed" && (rec.status === "approved" ? i === 3 : i === 2);
  const reject = async () => {
    await status.mutateAsync({ id: rec.id, status: "rejected" });
    txn.notify({ tone: "info", title: "Recommendation rejected", body: "Nothing was executed. Vaulto logged the decision; run a new analysis whenever you want a fresh proposal." });
  };
  const stepper = [
    ["Treasury scanned", "Idle capital detected"],
    ["OpenServ reasoning", rec.reasoningSource === "openserv" ? "Risk + allocation explained" : "Local engine (OpenServ key not set)"],
    ["Recommended allocation", rec.status === "approved" || rec.status === "executed" ? "Approved" : closed ? "Reviewed" : "Review below"],
    ["Your approval", rec.status === "executed" ? (snapshot.executionMode === "live" ? "Executed on-chain" : "Simulation passed") : rec.status === "approved" ? (snapshot.executionMode === "live" ? "Awaiting wallet signature" : "Run the simulation") : closed ? (rec.status === "rejected" ? "Rejected" : "Dismissed") : snapshot.executionMode === "live" ? "Wallet signature" : "Simulation"],
  ];

  return (
    <div className="grid content-start gap-6">
      {closed && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-canvas px-4 py-3 text-[13px] text-body">
          <span>
            <b className="text-ink">{rec.status === "rejected" ? "You rejected this recommendation." : "This recommendation was dismissed."}</b> Nothing was executed; it is kept here for reference.
          </span>
          <button className="btn btn-primary h-9 text-[13px]" disabled={analyze.isPending} onClick={() => analyze.mutate()}>
            Run new analysis
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold text-muted">
            Strategy · Proposed {fmtTime(rec.createdAt)} today · {rec.reasoningSource === "openserv" ? `OpenServ${rec.reasoningModel ? ` · ${rec.reasoningModel}` : ""}` : "Vaulto local reasoning (OpenServ keys not configured)"}
          </div>
          <div className="mt-1 font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">{rec.title}</div>
        </div>
        <div className="flex items-center gap-2">
          {rec.status !== "proposed" && <Pill tone={rec.status === "executed" ? "green" : rec.status === "approved" ? "blue" : "muted"} className="h-7 px-3 text-[13px] capitalize">{rec.status}</Pill>}
          <Pill tone="blue" className="h-7 px-3 text-[13px]">{rec.confidence}% confidence</Pill>
        </div>
      </div>

      <div className="grid overflow-hidden rounded-[14px] border border-line bg-white sm:grid-cols-2 lg:grid-cols-4">
        {stepper.map(([t, b], i) => {
          const done = stepDone(i);
          const current = stepCurrent(i);
          return (
            <div key={t} className={cx("flex items-center gap-3 px-5 py-4 lg:border-r lg:border-line-2 lg:last:border-0", current && "bg-tint-2")}>
              <span className={cx("flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full font-display text-[12px] font-semibold", done ? "bg-green text-white" : current ? "bg-blue text-white" : "border-[1.5px] border-[#CBD5E1] text-faint")}>{done ? "✓" : i + 1}</span>
              <div>
                <div className={cx("text-[13px] font-semibold", current ? "text-blue-deep" : done ? "text-ink" : "text-faint")}>{t}</div>
                <div className="text-[12px] text-faint">{b}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <div className="grid gap-5">
          <Card>
            <CardTitle>Current treasury condition</CardTitle>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <Stat label="Idle capital" value={<span className="text-amber">{fmtUsd(snapshot.idleUsd)}</span>} sub={`${idle.map((a) => fmtAmount(a.idleAmount, a.symbol)).join(" + ")} · ${snapshot.idlePct}%`} />
              <Stat label="Blended yield" value={`${snapshot.blendedApy.toFixed(1)}%`} sub="on total treasury" />
              <Stat label="Monthly burn" value={user.monthlyBurnUsd > 0 ? fmtUsd(user.monthlyBurnUsd) : "—"} sub={user.monthlyBurnUsd > 0 ? `${snapshot.runwayMonths} months runway` : "set in Settings"} />
            </div>
            <div className="mt-4 text-[14px] leading-[1.6] text-body">
              Your policy: keep at least <b className="text-ink">{user.liquidityFloorPct}% liquid</b>, never sell assets to chase yield, minimum vault risk score <b className="text-ink">{user.minVaultRiskScore}</b>, max single-asset exposure <b className="text-ink">{user.maxAssetExposurePct}%</b>.
            </div>
          </Card>

          <Card>
            <CardTitle action={<span className="text-[12px] font-medium text-faint">{rec.steps.length} steps · {(rec.durationMs / 1000).toFixed(1)}s</span>}>How Vaulto reasoned</CardTitle>
            <div className="mt-3 grid">
              {rec.steps.map((s, i) => (
                <div key={i} className="flex gap-3.5 border-b border-canvas py-3.5 last:border-0">
                  <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-tint font-display text-[12px] font-semibold text-blue-deep">{i + 1}</span>
                  <div>
                    <div className="text-[14px] font-semibold text-ink">
                      {s.agent} · {s.title}
                    </div>
                    <div className="mt-0.5 text-[13px] leading-[1.5] text-muted">{s.body}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="grid gap-5">
          <Card accent={rec.status === "proposed"} className={closed ? "opacity-80" : undefined}>
            <CardTitle action={<Link href="/app/vaults" className="text-[12px] font-semibold text-blue-deep">Compare strategies</Link>}>Recommended allocation</CardTitle>
            <div className="mt-4 grid gap-3.5">
              <BeforeAfterBar label="Idle capital" before={rec.before.idlePct} after={rec.after.idlePct} />
              {rec.legs.map((l) => (
                <BeforeAfterBar key={l.strategyId} label={vaultLabel(l.vaultName)} before={rec.before.perStrategyPct[l.strategyId] ?? 0} after={rec.after.perStrategyPct[l.strategyId] ?? 0} />
              ))}
            </div>
            <div className="mt-4 grid gap-2">
              {rec.legs.map((l) => {
                const s = byId.get(l.strategyId);
                return (
                  <div key={l.strategyId} className="flex items-center justify-between rounded-xl border border-line px-4 py-3 text-[13px]">
                    <div>
                      <div className="font-semibold text-ink">{l.vaultName}</div>
                      <div className="text-[12px] text-muted">
                        {s?.chainName} · {s?.liquidity} · risk {l.riskScore} · {l.executable ? (snapshot.executionMode === "live" ? `${fmtAmount(l.onchainAmount, l.asset)} on-chain · wallet signs` : "simulated on BNB mainnet") : "not executable"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-display text-[15px] font-semibold text-ink">{fmtAmount(l.amount, l.asset)}</div>
                      <div className="text-[12px] text-muted">
                        {fmtUsd(l.amountUsd)} · {l.apy}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <Stat
                label="Blended yield"
                value={
                  <>
                    {rec.before.blendedApy.toFixed(1)}% → <span className="text-green">{rec.after.blendedApy.toFixed(1)}%</span>
                  </>
                }
              />
              <Stat label="Extra income" value={<span className="text-green">+{fmtUsd(rec.extraMonthlyUsd)} / mo</span>} />
              <Stat label="Liquid" value={`${rec.before.liquidPct}% → ${rec.after.liquidPct}%`} />
              <Stat
                label="Health score"
                value={
                  <>
                    {rec.before.healthScore} → <span className="text-green">{rec.after.healthScore}</span>
                  </>
                }
              />
            </div>
            {rec.status === "executed" ? (
              <div className="mt-5 rounded-xl bg-green-tint px-4 py-3 text-[13px] font-medium text-green">{snapshot.executionMode === "live" ? "Executed on-chain. Positions updated; the Monitoring Agent is tracking the vault." : "Simulation passed (eth_call + state override on BNB mainnet). No funds moved; Activity holds the expected shares."}</div>
            ) : closed ? (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-canvas px-4 py-3 text-[13px] font-medium text-muted">
                <span>{rec.status === "rejected" ? "Rejected · not executed" : "Dismissed · not executed"}</span>
                <button className="btn btn-soft h-9 text-[13px]" onClick={() => txn.open(rec.id)}>
                  Approve anyway
                </button>
              </div>
            ) : (
              <>
                <div className="mt-5 flex flex-wrap gap-2.5">
                  <button className="btn btn-primary h-12 flex-1 rounded-xl text-[15px]" onClick={() => txn.open(rec.id)}>
                    Approve strategy
                  </button>
                  <Link href="/app/vaults" className="btn btn-soft h-12 rounded-xl px-4 text-[15px]">Compare</Link>
                  <button className="btn btn-danger h-12 rounded-xl px-3.5 text-[15px]" disabled={status.isPending} onClick={reject}>
                    {status.isPending ? "Rejecting…" : "Reject"}
                  </button>
                </div>
                <div className="mt-3 text-center text-[12px] leading-[1.5] text-faint">
                  {rec.txCount} calldata step{rec.txCount > 1 ? "s" : ""} via IXS MCP · {snapshot.executionMode === "live" ? `wallet signature required · est. fee ${fmtUsd(rec.feeUsd, { decimals: 2 })}` : "simulated on BNB mainnet · nothing is sent"}
                </div>
              </>
            )}
          </Card>

          <Card className="px-6 py-5">
            <div className="font-display text-[14px] font-semibold text-ink">What Vaulto considered and rejected</div>
            <div className="mt-2.5 grid gap-2 text-[13px] leading-[1.5] text-muted">
              {rec.rejected.map((r) => (
                <div key={r.option} className="flex justify-between gap-3">
                  <span>{r.option}</span>
                  <span className={cx("text-right font-semibold", r.tone === "warn" ? "text-amber" : "text-faint")}>{r.reason}</span>
                </div>
              ))}
              {!rec.rejected.length && <div>Every candidate passed policy.</div>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
