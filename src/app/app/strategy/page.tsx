"use client";

import Link from "next/link";
import { AnalysisProgress } from "@/components/dashboard/recommendation-card";
import { useTxn } from "@/components/txn/txn-provider";
import { useAnalyze, useRecommendationStatus, useTreasury } from "@/hooks/use-vaulto";
import { chainInfo, modeLabel } from "@/lib/chain/config";
import { fmtAmount, fmtTime, fmtUsd, vaultLabel } from "@/lib/format";
import { BeforeAfterBar, Card, CardTitle, EmptyState, ErrorState, OpenServBadge, Pill, Skeleton, Stat, cx } from "@/components/ui";

function VerdictPill({ verdict }: { verdict: "allocate" | "defer" | "reject" }) {
  return <Pill tone={verdict === "allocate" ? "green" : verdict === "defer" ? "amber" : "red"}>{verdict === "allocate" ? "ALLOCATE" : verdict === "defer" ? "DEFER" : "REJECT"}</Pill>;
}

export default function StrategyPage() {
  const treasury = useTreasury();
  const analyze = useAnalyze();
  const status = useRecommendationStatus();
  const txn = useTxn();

  if (treasury.isError) return <ErrorState message={treasury.error.message} retry={() => treasury.refetch()} />;
  if (!treasury.data) return <Skeleton className="h-96" />;

  const { user, snapshot, recommendation: rec, strategies, cutoff } = treasury.data;

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

  if (!rec) {
    return (
      <EmptyState
        title="No strategy proposed yet"
        body="Run an analysis: Vaulto scans the treasury, runs the pre-flight checks on every IXS vault (deposit limit, NAV age, minimum, eligibility, cutoff) and SERV reasoning returns one verdict per vault with its reason."
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
  const hasLegs = rec.legs.length > 0;
  const legChains = [...new Set(rec.legs.map((l) => l.chainId))];
  const live = legChains.length > 0 && legChains.every((c) => snapshot.liveChainIds.includes(c));
  const execLabel = legChains.length ? legChains.map((c) => modeLabel(snapshot.liveChainIds.includes(c) ? "live" : "simulated", c, snapshot.onchain.byChain?.[c]?.rpcKind ?? "mainnet")).join(" + ") : modeLabel("simulated", 56);
  const asyncLegs = rec.legs.filter((l) => byId.get(l.strategyId)?.settlement === "async-erc7540");
  const stepDone = (i: number) => rec.status === "executed" || (rec.status === "approved" ? i <= 2 : closed ? i <= 2 : i <= 1);
  const stepCurrent = (i: number) => !closed && rec.status !== "executed" && (rec.status === "approved" ? i === 3 : i === 2);
  const reject = async () => {
    await status.mutateAsync({ id: rec.id, status: "rejected" });
    txn.notify({ tone: "info", title: "Recommendation rejected", body: "Nothing was executed. Vaulto logged the decision; run a new analysis whenever you want a fresh proposal." });
  };
  const stepper = [
    ["Treasury scanned", "Idle capital + pre-flight per vault"],
    ["SERV reasoning", (rec.decisionSource ?? rec.reasoningSource) === "openserv" ? ((rec.narrativeSource ?? rec.reasoningSource) === "openserv" ? "One verdict per vault + memo" : "One verdict per vault (memo by the local engine)") : "Local engine (OpenServ unavailable)"],
    ["Recommended allocation", rec.status === "approved" || rec.status === "executed" ? "Approved" : closed ? "Reviewed" : hasLegs ? "Review below" : "Nothing allocatable"],
    ["Your approval", rec.status === "executed" ? (live ? "Executed on-chain" : "Simulation passed") : rec.status === "approved" ? (live ? "Awaiting wallet signature" : "Run the simulation") : closed ? (rec.status === "rejected" ? "Rejected" : "Dismissed") : live ? "Wallet signature" : "Simulation"],
  ];
  const decisions = rec.decisions ?? [];

  return (
    <div className="grid content-start gap-6">
      {closed && hasLegs && (
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
            Strategy · {fmtTime(rec.createdAt)} today · {rec.reasoningSource === "openserv" ? `OpenServ${rec.reasoningModel ? ` · ${rec.reasoningModel}` : ""}` : "Vaulto local reasoning (OpenServ unavailable)"} · {execLabel}
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

      {/* Verdicts: one per candidate vault, from SERV reasoning */}
      <Card>
        <CardTitle action={<span className="text-[12px] font-medium text-faint">{decisions.length} vault{decisions.length === 1 ? "" : "s"} · every candidate gets a verdict · {rec.validatorOverrides?.length ?? 0} validator override{(rec.validatorOverrides?.length ?? 0) === 1 ? "" : "s"}</span>}>SERV verdicts per vault</CardTitle>
        <div className="mt-1 text-[12px] text-muted">
          <b className="text-ink">SERV decides; deterministic policy guardrails enforce hard limits</b>
          {rec.guardrails ? ` (liquidity floor ${rec.guardrails.liquidityFloorPct}%, exposure cap ${rec.guardrails.maxAssetExposurePct}%, min vault score ${rec.guardrails.minVaultRiskScore}, min deposit ${rec.guardrails.minDepositUsd} USDC${(rec.guardrails.liveDepositMinimums ?? []).filter((m) => m.usd > rec.guardrails!.minDepositUsd).map((m) => `, Live minimum ${m.usd} USDC into ${m.symbol} = ${m.formula}`).join("")}, Live cap ${rec.guardrails.maxLiveTxUsdc.toLocaleString("en-US")} USDC per tx, NAV stale after ${rec.guardrails.navStaleHours} h; Live mode ${rec.guardrails.liveOptIn ? "opted in" : "off, so this run is simulated"})` : ""}.
          {rec.validatorOverrides?.length ? ` Validator overrides in this run: ${rec.validatorOverrides.join("; ")}.` : " No validator override was needed in this run."}
        </div>
        <div className="mt-3 grid gap-2">
          {decisions.map((d) => {
            const s = byId.get(d.strategyId);
            const p = rec.preflights?.[d.strategyId];
            return (
              <details key={d.strategyId} className="rounded-xl border border-line px-4 py-3">
                <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-[13px]">
                  <VerdictPill verdict={d.verdict} />
                  <span className="font-semibold text-ink">{s?.vaultName ?? d.strategyId}</span>
                  {s && <span className="text-faint">{s.chainName}</span>}
                  {d.verdict === "allocate" && d.amount != null && <span className="font-display font-semibold text-ink">{d.amount.toLocaleString("en-US")} {s?.asset}</span>}
                  <span className="min-w-0 flex-1 text-right text-[12px] text-muted">{d.reason}</span>
                </summary>
                {p ? (
                  <div className="mt-3 grid gap-1 border-t border-line-3 pt-3 text-[12px] text-muted">
                    {p.checks.map((c) => (
                      <div key={c.key} className="grid gap-1 sm:grid-cols-[1.1fr_1fr_2fr]">
                        <span>
                          <span className={cx("mr-1 font-semibold", c.ok ? "text-green" : c.severity === "info" ? "text-faint" : c.severity === "defer" ? "text-amber" : "text-red")}>{c.ok ? "✓" : c.severity === "info" ? "·" : "✗"}</span>
                          {c.label}
                        </span>
                        <span className="font-semibold text-ink">{c.value}</span>
                        <span className="text-faint">
                          {c.detail} <span className="text-[11px]">· {c.source}</span>
                        </span>
                      </div>
                    ))}
                    <div className="mt-1 text-[11px] text-faint">
                      Checked {new Date(p.checkedAt).toLocaleString()} · block {p.blockNumber?.toLocaleString("en-US") ?? "?"} · wallet {p.wallet.slice(0, 8)}…
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 border-t border-line-3 pt-3 text-[12px] text-muted">No vault deployed on the IXS Vault API; nothing to pre-flight.</div>
                )}
              </details>
            );
          })}
          {!decisions.length && <div className="text-[13px] text-muted">No candidate vault matched the idle assets.</div>}
        </div>
      </Card>

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
              Your policy: keep at least <b className="text-ink">{user.liquidityFloorPct}% liquid</b>, never sell assets to chase yield, minimum vault risk score <b className="text-ink">{user.minVaultRiskScore}</b>, max single-asset exposure <b className="text-ink">{user.maxAssetExposurePct}%</b>, minimum deposit <b className="text-ink">100 USDC</b> (IXS).
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

          {rec.trace && (
            <Card>
              <CardTitle action={<Pill tone={rec.trace.source === "openserv" ? "green" : "muted"}>{rec.trace.source === "openserv" ? `OpenServ · ${rec.trace.model ?? ""}` : "local engine"}</Pill>}>SERV reasoning · input and output</CardTitle>
              <div className="mt-2 text-[12px] text-muted">The exact facts handed to SERV reasoning and the raw JSON it returned. Also on the Evidence page.</div>
              <details className="mt-3 rounded-xl border border-line px-4 py-3 text-[12px]">
                <summary className="cursor-pointer font-semibold text-ink">Decision input (facts JSON)</summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all text-[11px] text-muted">{JSON.stringify(rec.trace.decision.input, null, 2)}</pre>
              </details>
              <details className="mt-2 rounded-xl border border-line px-4 py-3 text-[12px]">
                <summary className="cursor-pointer font-semibold text-ink">Decision output (verdicts JSON)</summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all text-[11px] text-muted">{JSON.stringify(rec.trace.decision.output, null, 2)}</pre>
              </details>
              {rec.trace.narrative && (
                <details className="mt-2 rounded-xl border border-line px-4 py-3 text-[12px]">
                  <summary className="cursor-pointer font-semibold text-ink">Memo output (JSON)</summary>
                  <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all text-[11px] text-muted">{JSON.stringify(rec.trace.narrative.output, null, 2)}</pre>
                </details>
              )}
            </Card>
          )}
        </div>

        <div className="grid gap-5">
          <Card accent={rec.status === "proposed" && hasLegs} className={closed ? "opacity-80" : undefined}>
            <CardTitle action={<Link href="/app/vaults" className="text-[12px] font-semibold text-blue-deep">Compare vaults</Link>}>Recommended allocation</CardTitle>
            {hasLegs ? (
              <>
                <div className="mt-4 grid gap-3.5">
                  <BeforeAfterBar label="Idle capital" before={rec.before.idlePct} after={rec.after.idlePct} />
                  {rec.legs.map((l) => (
                    <BeforeAfterBar key={l.strategyId} label={vaultLabel(l.vaultName)} before={rec.before.perStrategyPct[l.strategyId] ?? 0} after={rec.after.perStrategyPct[l.strategyId] ?? 0} />
                  ))}
                </div>
                <div className="mt-4 grid gap-2">
                  {rec.legs.map((l) => {
                    const s = byId.get(l.strategyId);
                    const legLive = snapshot.liveChainIds.includes(l.chainId);
                    return (
                      <div key={l.strategyId} className="flex items-center justify-between rounded-xl border border-line px-4 py-3 text-[13px]">
                        <div>
                          <div className="font-semibold text-ink">{l.vaultName}</div>
                          <div className="text-[12px] text-muted">
                            {chainInfo(l.chainId).name} · {s?.settlement === "sync" ? "settles in the deposit tx" : "request → operator settles after cutoff"} · risk {l.riskScore} · {legLive ? `${fmtAmount(l.onchainAmount, l.asset)} on-chain · wallet signs` : `simulated on ${chainInfo(l.chainId).short} mainnet`}
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
                {asyncLegs.length > 0 && (
                  <div className="mt-4 rounded-xl bg-tint px-4 py-3 text-[12px] text-body">
                    <b className="text-ink">Cutoff-aware:</b> send the request before <b className="text-ink">{cutoff.nextCutoffSgt}</b> (in {cutoff.hoursUntilCutoff} h) to be processed at that cutoff; estimated settlement <b className="text-ink">{cutoff.estimatedSettlementSgt}</b>
                    {cutoff.skipped.length ? ` (skipping ${cutoff.skipped.map((s) => `${s.date} ${s.reason}`).join(", ")})` : ""}. {cutoff.holidayAssumption}.
                  </div>
                )}
                {rec.status === "executed" ? (
                  <div className="mt-5 rounded-xl bg-green-tint px-4 py-3 text-[13px] font-medium text-green">{live ? (asyncLegs.length ? "Request submitted — pending operator settlement. Activity holds the hashes." : "Executed on-chain. Positions updated; the Monitoring Agent is tracking the vault.") : "Simulation passed (eth_call + state override against the real vault). No funds moved; Activity holds the expected shares."}</div>
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
                        Approve &amp; execute ({live ? "Live" : "Simulate"})
                      </button>
                      <Link href="/app/vaults" className="btn btn-soft h-12 rounded-xl px-4 text-[15px]">Compare</Link>
                      <button className="btn btn-danger h-12 rounded-xl px-3.5 text-[15px]" disabled={status.isPending} onClick={reject}>
                        {status.isPending ? "Rejecting…" : "Reject"}
                      </button>
                    </div>
                    <div className="mt-3 text-center text-[12px] leading-[1.5] text-faint">
                      {rec.txCount} calldata step{rec.txCount > 1 ? "s" : ""} via IXS MCP · {live ? `wallet signature required · approve exact amount · hard cap ${(rec.guardrails?.maxLiveTxUsdc ?? 0).toLocaleString("en-US")} USDC per tx · est. fee ${fmtUsd(rec.feeUsd, { decimals: 2 })}` : `${execLabel} · nothing is sent`}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="mt-4 rounded-xl bg-canvas px-4 py-3 text-[13px] text-body">
                <b className="text-ink">{rec.headline}</b> {rec.summary}
                <div className="mt-3">
                  <button className="btn btn-primary h-9 text-[13px]" disabled={analyze.isPending} onClick={() => analyze.mutate()}>
                    Re-run analysis
                  </button>
                </div>
              </div>
            )}
          </Card>

          {rec.memo && (
            <Card>
              <CardTitle action={<Pill tone={(rec.narrativeSource ?? rec.reasoningSource) === "openserv" ? "green" : "muted"}>{(rec.narrativeSource ?? rec.reasoningSource) === "openserv" ? "written by OpenServ" : "local engine (OpenServ narrative unavailable)"}</Pill>}>Allocation memo</CardTitle>
              <div className="mt-1 text-[12px] text-muted">{rec.memo.title}</div>
              <div className="mt-3 grid gap-3">
                {rec.memo.sections.map((sec) => (
                  <div key={sec.heading}>
                    <div className="text-[12px] font-semibold uppercase tracking-[0.05em] text-faint">{sec.heading}</div>
                    <div className="mt-1 text-[13px] leading-[1.6] text-body">{sec.body}</div>
                  </div>
                ))}
              </div>
              {hasLegs && !closed && rec.status !== "executed" && (
                <button className="btn btn-primary mt-4 h-11 w-full rounded-xl text-[14px]" onClick={() => txn.open(rec.id)}>
                  Approve &amp; execute ({live ? "Live" : "Simulate"})
                </button>
              )}
            </Card>
          )}

          <Card className="px-6 py-5">
            <div className="font-display text-[14px] font-semibold text-ink">Deferred and rejected</div>
            <div className="mt-2.5 grid gap-2 text-[13px] leading-[1.5] text-muted">
              {(rec.deferred ?? []).map((r) => (
                <div key={`d-${r.option}`} className="flex justify-between gap-3">
                  <span>
                    <Pill tone="amber" className="mr-2 h-5 px-1.5 text-[10px]">DEFER</Pill>
                    {r.option}
                  </span>
                  <span className="text-right font-semibold text-amber">{r.reason}</span>
                </div>
              ))}
              {rec.rejected.map((r) => (
                <div key={`r-${r.option}`} className="flex justify-between gap-3">
                  <span>
                    {r.verdict === "reject" && <Pill tone="red" className="mr-2 h-5 px-1.5 text-[10px]">REJECT</Pill>}
                    {r.option}
                  </span>
                  <span className={cx("text-right font-semibold", r.tone === "warn" ? "text-red" : "text-faint")}>{r.reason}</span>
                </div>
              ))}
              {!rec.rejected.length && !(rec.deferred ?? []).length && <div>Every candidate passed pre-flight and policy.</div>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
