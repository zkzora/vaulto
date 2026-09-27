"use client";

import { useAnalyze } from "@/hooks/use-vaulto";
import { cx } from "@/components/ui";
import type { Recommendation, ServRunInfo } from "@/lib/types";

/** "2026-09-27 06:13 UTC" */
export const servTime = (iso: string) => `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;
const usd = (n: number) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(3)}`;

/** Short label for one stage, e.g. "SERV output (cached from 2026-09-27 06:13 UTC)". */
export function servStageLabel(run: ServRunInfo | undefined, fallback: string): string {
  if (!run) return fallback;
  if (run.status === "fresh") return "SERV output (fresh)";
  if (run.status === "cached") return `SERV output (cached from ${servTime(run.at)})`;
  if (run.status === "stale") return `SERV unavailable — last SERV output from ${servTime(run.at)}`;
  return "local fallback (SERV unavailable)";
}

/**
 * Where the verdicts and the memo of this recommendation come from, stated plainly: a fresh SERV call, a stored SERV
 * output reused for identical inputs, the last SERV output shown because SERV failed, or the local fallback engine.
 * "Re-run SERV" always calls OpenServ again.
 */
export function ServStatusBar({ rec, className }: { rec: Recommendation; className?: string }) {
  const analyze = useAnalyze();
  const s = rec.serv;
  if (!s) return null;
  const d = s.decision;
  const n = s.narrative;
  const tone = s.status === "local" ? "border-red/30 bg-red/10 text-red" : s.status === "stale" ? "border-amber-line bg-amber-tint text-amber" : s.status === "fresh" ? "border-green/30 bg-green-tint text-green" : "border-line bg-tint text-blue-deep";
  const title =
    s.status === "fresh"
      ? `SERV output · fresh run ${servTime(d.at)}`
      : s.status === "cached"
        ? `SERV output (cached from ${servTime(d.at)})`
        : s.status === "mixed"
          ? `SERV output · verdicts ${d.status === "cached" ? `cached from ${servTime(d.at)}` : "fresh"}, memo ${n.status === "cached" ? `cached from ${servTime(n.at)}` : "fresh"}`
          : s.status === "stale"
            ? `SERV unavailable — showing last SERV output from ${servTime((d.status === "stale" ? d : n).at)}`
            : `Local fallback — SERV unavailable`;
  const error = (s.status === "stale" || s.status === "local") && (d.error ?? n.error);
  const detail =
    s.status === "cached" || s.status === "mixed"
      ? `Identical inputs (vault state, treasury, policy, block ${rec.context?.replayBlock ?? "current"}, prompt ${d.promptVersion}): the stored SERV output is reused, so no OpenServ credit is spent${s.savedUsd ? ` (saved ≈ ${usd(s.savedUsd)})` : ""}. Guardrails, validator and simulation run on the current state; USD totals and ages in the text are as of the SERV run.`
      : s.status === "fresh"
        ? `OpenServ spend ≈ ${usd(s.costUsd)}${d.usage && n.usage ? ` (verdicts ${d.usage.promptTokens.toLocaleString("en-US")} in / ${d.usage.completionTokens.toLocaleString("en-US")} out tokens, memo ${n.usage.promptTokens.toLocaleString("en-US")} in / ${n.usage.completionTokens.toLocaleString("en-US")} out)` : ""}. Stored for identical inputs.`
        : s.status === "stale"
          ? `${error}. The verdicts and memo below are the last SERV output for these exact inputs; guardrails and simulation still run now.`
          : `${error}. Verdicts${n.status === "local" ? " and memo" : ""} below come from the Vaulto local engine (deterministic rules), not from SERV.`;

  return (
    <div className={cx("flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[12px] leading-[1.5]", tone, className)}>
      <div className="min-w-0 flex-1">
        <b>{title}</b>
        <span className="text-body"> · {detail}</span>
      </div>
      <button type="button" className="btn btn-soft h-8 shrink-0 text-[12px]" disabled={analyze.isPending} onClick={() => analyze.mutate({ fresh: true })}>
        {analyze.isPending && <span className="spinner" />}
        {analyze.isPending ? "Running SERV…" : "Re-run SERV"}
      </button>
    </div>
  );
}
