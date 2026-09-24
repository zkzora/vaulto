"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTxn } from "@/components/txn/txn-provider";
import { useAnalyze, useRecommendationStatus } from "@/hooks/use-vaulto";
import { fmtUsd } from "@/lib/format";
import type { Recommendation, TreasurySnapshot } from "@/lib/types";
import { OpenServBadge, Pill, cx } from "@/components/ui";

const PROGRESS = [
  "Treasury Scanner reading balances on BNB Chain…",
  "Opportunity Finder matching idle assets to IXS vaults…",
  "Risk Guardian checking liquidity floor and exposure…",
  "Allocation Planner sizing the deposit…",
  "OpenServ writing the reasoning…",
];

export function AnalysisProgress({ compact }: { compact?: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => Math.min(PROGRESS.length - 1, v + 1)), 1100);
    return () => clearInterval(t);
  }, []);
  return (
    <div className={cx("grid gap-2", compact ? "mt-3" : "mt-5")}>
      {PROGRESS.map((p, idx) => (
        <div key={p} className={cx("flex items-center gap-2.5 text-[13px] transition-opacity", idx > i ? "opacity-30" : "opacity-100")}>
          <span className={cx("flex h-5 w-5 shrink-0 items-center justify-center rounded-full", idx < i ? "bg-green text-white" : idx === i ? "bg-blue" : "bg-line-2")}>
            {idx < i ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l5 5L20 7" />
              </svg>
            ) : idx === i ? (
              <span className="spinner" style={{ width: 10, height: 10 }} />
            ) : null}
          </span>
          <span className={idx === i ? "font-medium text-ink" : "text-muted"}>{p}</span>
        </div>
      ))}
    </div>
  );
}

export function RecommendationCard({ rec, snapshot }: { rec: Recommendation | null; snapshot: TreasurySnapshot }) {
  const analyze = useAnalyze();
  const status = useRecommendationStatus();
  const txn = useTxn();
  const proposed = rec && rec.status === "proposed";
  const executed = rec && rec.status === "executed";

  if (analyze.isPending) {
    return (
      <div className="card-accent flex flex-col p-6">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-blue-deep">Vaulto is analyzing</span>
          <OpenServBadge />
        </div>
        <div className="mt-3 font-display text-[18px] font-semibold text-ink">Running the multi-agent pipeline</div>
        <AnalysisProgress />
      </div>
    );
  }

  if (!rec || rec.status === "dismissed" || rec.status === "rejected" || (executed && rec.legs.length === 0)) {
    return (
      <div className="card flex flex-col p-6">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">AI recommendation center</span>
          <OpenServBadge />
        </div>
        <div className="mt-3 font-display text-[18px] font-semibold text-ink">{rec?.status === "rejected" ? "Last recommendation rejected" : rec?.status === "dismissed" ? (rec.legs.length ? "Last recommendation dismissed" : rec.headline) : "No open recommendation"}</div>
        <div className="mt-2 text-[14px] leading-relaxed text-body">
          {snapshot.idleUsd > 0
            ? `${fmtUsd(snapshot.idleUsd)} (${snapshot.idlePct}%) of the treasury is idle. Run an analysis and OpenServ will reason about the best IXS RWA strategy under your policy.`
            : "The treasury is fully deployed within policy. Vaulto keeps monitoring and will draft a recommendation when conditions change."}
        </div>
        {analyze.isError && <div className="mt-3 rounded-lg bg-amber-tint px-3 py-2 text-[12px] text-amber">{analyze.error.message}</div>}
        <div className="mt-auto flex flex-wrap gap-2 pt-5">
          <button className="btn btn-primary" onClick={() => analyze.mutate()}>
            Run analysis
          </button>
          {rec && rec.legs.length > 0 && (rec.status === "rejected" || rec.status === "dismissed") && (
            <Link href="/app/strategy" className="btn btn-soft">View {rec.status} proposal</Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cx("flex flex-col p-6", proposed ? "card-accent" : "card")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap text-[12px] font-semibold uppercase tracking-[0.06em] text-blue-deep">{executed ? "Executed" : rec.status === "approved" ? "Approved · awaiting execution" : "Vaulto recommends"}</span>
          <OpenServBadge />
        </div>
        <div className="flex items-center gap-2">
          {rec.reasoningSource === "local" && <Pill tone="muted">Local reasoning</Pill>}
          <Pill tone="blue" className="h-6 px-2.5 text-[12px]">{rec.confidence}% confidence</Pill>
        </div>
      </div>
      <div className="mt-3 grid gap-2.5">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Vaulto found</div>
          <div className="mt-0.5 font-display text-[16px] font-semibold leading-[1.3] tracking-[-0.01em] text-amber">{rec.foundLabel}</div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">{executed ? "Allocated" : "Recommended"}</div>
          <div className="mt-0.5 font-display text-[16px] font-semibold leading-[1.3] tracking-[-0.01em] text-ink">{rec.headline}</div>
        </div>
      </div>
      <div className="mt-3 grid gap-1.5 text-[14px] leading-[1.5] text-body">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">Reason</div>
        {rec.reasons.map((r) => (
          <div key={r.title} className="flex gap-2">
            <span className="text-blue">•</span>
            <span>
              <b className="text-ink">{r.title}</b> {r.body}
            </span>
          </div>
        ))}
      </div>
      {((rec.deferred?.length ?? 0) > 0 || rec.rejected.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          {(rec.deferred ?? []).map((d) => (
            <Pill key={`d-${d.option}`} tone="amber" className="h-5 px-1.5 text-[10px]">
              DEFER · {d.option.split(" · ")[0]}
            </Pill>
          ))}
          {rec.rejected.filter((r) => r.verdict === "reject").map((r) => (
            <Pill key={`r-${r.option}`} tone="red" className="h-5 px-1.5 text-[10px]">
              REJECT · {r.option.split(" · ")[0]}
            </Pill>
          ))}
        </div>
      )}
      <div className="mt-3.5 grid grid-cols-3 gap-3 rounded-[10px] bg-canvas px-3.5 py-3">
        <div>
          <div className="text-[12px] font-medium text-muted">Expected</div>
          <div className="font-display text-[16px] font-semibold text-green">+{fmtUsd(rec.extraMonthlyUsd)} / mo</div>
        </div>
        <div>
          <div className="text-[12px] font-medium text-muted">Yield after</div>
          <div className="font-display text-[16px] font-semibold text-ink">
            {rec.before.blendedApy.toFixed(1)}% → {rec.after.blendedApy.toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="text-[12px] font-medium text-muted">Health after</div>
          <div className="font-display text-[16px] font-semibold text-ink">
            {rec.before.healthScore} → {rec.after.healthScore}
          </div>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        {executed ? (
          <>
            <Link href="/app/activity" className="btn btn-primary h-[42px]">View activity</Link>
            <button className="btn btn-soft h-[42px]" onClick={() => analyze.mutate()}>Re-run analysis</button>
          </>
        ) : (
          <>
            <Link href="/app/strategy" className="btn btn-primary h-[42px]">Review strategy</Link>
            <button className="btn btn-soft h-[42px]" onClick={() => txn.open(rec.id)}>Approve</button>
            <button
              className="btn btn-ghost ml-auto h-[42px] px-2.5"
              disabled={status.isPending}
              onClick={async () => {
                await status.mutateAsync({ id: rec.id, status: "dismissed" });
                txn.notify({ tone: "info", title: "Recommendation dismissed", body: "Nothing was executed. It stays on the Strategy page for reference; run a new analysis for a fresh proposal." });
              }}
            >
              {status.isPending ? "Dismissing…" : "Dismiss"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
