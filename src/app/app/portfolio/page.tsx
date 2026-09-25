"use client";

import { useState } from "react";
import { usePortfolio } from "@/hooks/use-vaulto";
import { fmtShortDate, fmtUsd, vaultLabel } from "@/lib/format";
import { Card, CardTitle, ErrorState, Skeleton, TargetBar, cx } from "@/components/ui";

const PERIODS = [
  [7, "7D"],
  [30, "30D"],
  [90, "90D"],
  [365, "1Y"],
] as const;

function Chart({ points }: { points: { date: string; value: number }[] }) {
  if (points.length < 2) return null;
  const W = 800;
  const H = 220;
  const min = Math.min(...points.map((p) => p.value));
  const max = Math.max(...points.map((p) => p.value));
  const span = Math.max(1, max - min);
  const xy = points.map((p, i) => [(i / (points.length - 1)) * W, H - 30 - ((p.value - min) / span) * (H - 70)]);
  const line = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} V${H} H0 Z`;
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="mt-5 block" preserveAspectRatio="none">
      <defs>
        <linearGradient id="vg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#5B8DEF" stopOpacity=".25" />
          <stop offset="1" stopColor="#5B8DEF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g stroke="#EEF1F6" strokeWidth="1">
        <line x1="0" y1="55" x2={W} y2="55" />
        <line x1="0" y1="110" x2={W} y2="110" />
        <line x1="0" y1="165" x2={W} y2="165" />
      </g>
      <path d={area} fill="url(#vg)" />
      <path d={line} fill="none" stroke="#5B8DEF" strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="5" fill="#5B8DEF" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}

export default function PortfolioPage() {
  const [period, setPeriod] = useState<number>(30);
  const q = usePortfolio(period);

  if (q.isError) return <ErrorState message={q.error.message} retry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const { report, snapshot, strategies } = q.data;
  const byId = new Map(strategies.map((s) => [s.id, s]));
  const h = report.history;
  const labels = [h[0], h[Math.floor(h.length / 3)], h[Math.floor((2 * h.length) / 3)]].map((p) => fmtShortDate(p.date));

  return (
    <div className="grid content-start gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">Portfolio</div>
          <div className="mt-1 text-[14px] text-muted">
            {snapshot.assets.length} assets · {snapshot.positions.length} IXS vault{snapshot.positions.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex rounded-[10px] border border-line bg-white p-[3px] text-[13px] font-semibold text-muted">
          {PERIODS.map(([days, label]) => (
            <button key={days} onClick={() => setPeriod(days)} className={cx("rounded-lg px-3 py-[7px]", period === days && "bg-tint text-blue-deep")}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[2fr_1fr]">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="eyebrow">Treasury value</div>
              <div className="mt-2 font-display text-[40px] font-semibold leading-none tracking-[-0.025em] text-ink">{fmtUsd(snapshot.totalUsd)}</div>
              <div className={cx("mt-2 text-[14px] font-semibold", report.changeUsd >= 0 ? "text-green" : "text-red")}>
                {report.changeUsd >= 0 ? "+" : "−"}
                {fmtUsd(Math.abs(report.changeUsd))} ({report.changePct >= 0 ? "+" : ""}
                {report.changePct}%) · {report.periodDays} days
              </div>
            </div>
            <div className="flex gap-6 text-right">
              <div>
                <div className="text-[12px] font-medium text-muted">Yield earned</div>
                <div className="font-display text-[20px] font-semibold text-ink">{fmtUsd(report.yieldEarnedUsd)}</div>
              </div>
              <div>
                <div className="text-[12px] font-medium text-muted">Price change</div>
                <div className="font-display text-[20px] font-semibold text-ink">{fmtUsd(report.priceChangeUsd)}</div>
              </div>
            </div>
          </div>
          <Chart points={h} />
          <div className="flex justify-between text-[12px] font-medium text-faint">
            {labels.map((l, i) => (
              <span key={i}>{l}</span>
            ))}
            <span>Today</span>
          </div>
        </Card>
        <Card>
          <CardTitle>Target vs actual</CardTitle>
          <div className="mt-4 grid gap-3.5">
            {report.targets.map((t) => (
              <TargetBar key={t.label} label={t.label} actual={t.actualPct} target={t.targetPct} color={t.color} />
            ))}
          </div>
          <div className="mt-5 rounded-[10px] bg-tint px-3.5 py-3 text-[13px] leading-[1.5] font-medium text-blue-deep">{report.note}</div>
        </Card>
      </div>

      <div className="card overflow-x-auto px-6 py-2">
        <div className="min-w-[760px]">
          <div className="table-head" style={{ gridTemplateColumns: "1.6fr 1fr 1fr .8fr .8fr 1.6fr" }}>
            <span>Asset</span>
            <span>Value</span>
            <span>Allocation</span>
            <span>APY</span>
            <span>30D</span>
            <span>Where</span>
          </div>
          {snapshot.assets.map((a) => (
            <div key={a.symbol} className="table-row text-ink" style={{ gridTemplateColumns: "1.6fr 1fr 1fr .8fr .8fr 1.6fr" }}>
              <div className="flex items-center gap-3">
                <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full font-display text-[12px] font-bold text-white" style={{ background: a.color }}>
                  {a.symbol === "BTC" ? "₿" : a.symbol === "USDC" ? "$" : a.symbol[0]}
                </span>
                <div>
                  <div className="font-semibold">{a.symbol}</div>
                  <div className="text-[12px] font-normal text-faint">
                    {a.name}
                    {a.source === "onchain" ? " · on-chain" : a.source === "mixed" ? " · demo + on-chain" : ""}
                  </div>
                </div>
              </div>
              <span className="font-display text-[15px] font-semibold">{fmtUsd(a.valueUsd)}</span>
              <span>{a.allocationPct}%</span>
              <span className="font-display text-[15px] font-semibold">{a.apy.toFixed(1)}%</span>
              <span className={a.change30dPct > 0.1 ? "text-green" : "text-muted"}>+{a.change30dPct}%</span>
              <span className="text-[13px] font-normal text-muted">
                {a.deployedIn ? vaultLabel(byId.get(a.deployedIn)?.vaultName ?? a.deployedIn) : ""}
                {a.deployedIn && a.idleUsd > 0 ? " · " : ""}
                {a.idleUsd > 0 ? (a.deployedIn ? "Idle" : a.symbol === "USDC" ? "Idle · IX High Yield Bond candidate" : "Idle · no IXS vault for this asset yet") : ""}
              </span>
            </div>
          ))}
          {!snapshot.assets.length && <div className="py-8 text-center text-[13px] text-muted">No assets found on BNB Chain or Avalanche for this wallet. Turn on the simulated treasury in Settings to walk through the flow.</div>}
        </div>
      </div>
    </div>
  );
}
