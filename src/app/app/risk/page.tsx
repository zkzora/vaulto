"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTxn } from "@/components/txn/txn-provider";
import { useAnalyze, useRisk } from "@/hooks/use-vaulto";
import { fmtTime } from "@/lib/format";
import { Card, CardTitle, ErrorState, Icons, Pill, Skeleton, cx } from "@/components/ui";

const tone = (level: string) => (level === "Low" ? "green" : level === "Medium" ? "amber" : "red");

export default function RiskPage() {
  const q = useRisk();
  const txn = useTxn();
  const analyze = useAnalyze();
  const router = useRouter();

  if (q.isError) return <ErrorState message={q.error.message} retry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const { report, recommendation } = q.data;
  const color = report.healthScore >= 80 ? "#17996A" : report.healthScore >= 60 ? "#D07A1F" : "#D64545";

  const act = async (cta?: "review" | "analyze") => {
    if (cta === "review" && recommendation) txn.open(recommendation.id);
    else {
      await analyze.mutateAsync();
      router.push("/app/strategy");
    }
  };

  return (
    <div className="grid content-start gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">Risk Center</div>
          <div className="mt-1 text-[14px] text-muted">Scored on every scan against your policy · last check {fmtTime(report.checkedAt)}</div>
        </div>
        <Link href="/app/settings" className="btn btn-soft">Edit risk policy</Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <Card className="flex flex-col items-center p-7 text-center">
          <div className="eyebrow">Treasury health</div>
          <div className="relative mt-5 h-[200px] w-[200px] rounded-full" style={{ background: `conic-gradient(${color} 0 ${report.healthScore}%, #EEF1F6 ${report.healthScore}% 100%)` }}>
            <div className="absolute inset-4 flex flex-col items-center justify-center rounded-full bg-white">
              <span className="font-display text-[64px] font-semibold leading-none tracking-[-0.03em] text-ink">{report.healthScore}</span>
              <span className="mt-1 text-[13px] font-semibold text-faint">out of 100</span>
            </div>
          </div>
          <Pill tone={report.healthScore >= 80 ? "green" : "amber"} className="mt-[18px] h-7 px-3 text-[13px]">{report.healthLabel}</Pill>
          <div className="mt-3.5 text-[14px] leading-[1.55] text-muted">{report.healthNote}</div>
          <div className="mt-5 grid w-full gap-1.5 rounded-xl bg-canvas p-3.5 text-left text-[12px] text-muted">
            <div className="flex justify-between"><span>Liquidity floor</span><b className="text-ink">{report.policy.liquidityFloorPct}%</b></div>
            <div className="flex justify-between"><span>Max asset exposure</span><b className="text-ink">{report.policy.maxAssetExposurePct}%</b></div>
            <div className="flex justify-between"><span>Min vault risk score</span><b className="text-ink">{report.policy.minVaultRiskScore}</b></div>
          </div>
        </Card>
        <div className="grid gap-3.5">
          {report.items.map((it) => (
            <div key={it.key} className={cx("grid items-center gap-5 rounded-2xl bg-white px-6 py-5 sm:grid-cols-[1fr_auto]", it.level === "Low" ? "border border-line" : "border-[1.5px] border-amber-line")}>
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="font-display text-[16px] font-semibold text-ink">{it.title}</span>
                  <Pill tone={tone(it.level)}>{it.level}</Pill>
                </div>
                <div className="mt-1.5 text-[14px] leading-[1.5] text-muted">{it.description}</div>
              </div>
              <div className="text-left sm:text-right">
                <div className={cx("font-display text-[30px] font-semibold leading-none", it.level === "Low" ? "text-ink" : "text-amber")}>{it.value}</div>
                <div className="mt-1 text-[12px] font-medium text-faint">{it.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Card>
        <CardTitle action={<span className="text-[12px] font-medium text-faint">{report.alerts.length} open</span>}>AI warnings and corrective actions</CardTitle>
        <div className="mt-4 grid gap-3">
          {report.alerts.map((a) => (
            <div key={a.id} className={cx("grid items-center gap-4 rounded-xl px-[18px] py-4 sm:grid-cols-[auto_1fr_auto]", a.kind === "action" ? "bg-tint" : "bg-canvas")}>
              <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-white">{a.kind === "action" ? Icons.warn : Icons.info}</span>
              <div>
                <div className="text-[14px] font-semibold text-ink">{a.title}</div>
                <div className="mt-0.5 text-[13px] leading-[1.5] text-body">{a.body}</div>
              </div>
              <div className="flex gap-2">
                <button className={cx("btn h-[38px] text-[13px]", a.kind === "action" ? "btn-primary" : "btn-soft")} disabled={analyze.isPending} onClick={() => act(a.cta)}>
                  {a.cta === "review" ? "Review" : analyze.isPending ? "Analyzing…" : "Analyze"}
                </button>
                {a.kind === "action" && <button className="btn btn-ghost h-[38px] text-[13px]">Snooze</button>}
              </div>
            </div>
          ))}
          {!report.alerts.length && <div className="py-4 text-[13px] text-muted">No open warnings. The Monitoring Agent re-scores the treasury on every scan.</div>}
        </div>
      </Card>
    </div>
  );
}
