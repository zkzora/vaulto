"use client";

import Link from "next/link";
import { useState } from "react";
import { useEvidence } from "@/hooks/use-vaulto";
import { chainInfo } from "@/lib/chain/config";
import type { EvidenceResponse, EvidenceSnapshot } from "@/lib/client-api";
import { Card, ErrorState, Icons, Pill, Skeleton, VaultoLogo, cx } from "@/components/ui";

const KINDS = ["all", "serv", "mcp", "simulation", "onchain", "subgraph", "ixs-api", "fork", "live"] as const;

const ageText = (h: number | null | undefined) => (h == null ? "unknown" : h < 48 ? `${h.toFixed(1)} h ago` : `${(h / 24).toFixed(1)} days ago`);
const utc = (iso: string | null | undefined) => (iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "unknown");
const verdictTone = (v: string) => (/allocate/i.test(v) ? "green" : /defer/i.test(v) ? "amber" : "red");

function Json({ value, max = "max-h-80" }: { value: unknown; max?: string }) {
  return <pre className={cx("mt-1 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-canvas p-3 text-[11px] text-muted", max)}>{JSON.stringify(value, null, 1)}</pre>;
}

function SnapshotBadge({ s }: { s: EvidenceSnapshot }) {
  return (
    <Pill tone="blue">
      Committed snapshot · {utc(s.capturedAt)}
    </Pill>
  );
}

function ServCard({ s }: { s: EvidenceSnapshot }) {
  const a = s.analysis;
  if (!a) return null;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-display text-[16px] font-semibold text-ink">SERV verdicts per vault · public demo run</div>
        <SnapshotBadge s={s} />
      </div>
      <div className="mt-1 text-[12px] text-muted">
        {a.treasury} · wallet <span className="mono">{a.wallet}</span> · reasoning <b className="text-ink">{a.reasoningSource === "openserv" ? `OpenServ (${a.reasoningModel ?? "SERV"})` : "local fallback"}</b>
        {a.confidence != null ? ` · confidence ${a.confidence}%` : ""} · validator overrides <b className="text-ink">{a.validatorOverrides?.length ?? 0}</b> · captured from <span className="mono">{s.baseUrl}</span>
        {s.file ? <> · <span className="mono">{s.file}</span> in the repo</> : null}
      </div>
      <div className="mt-1 text-[12px] font-semibold text-ink">SERV decides; deterministic policy guardrails enforce hard limits.</div>
      {s.note && <div className="mt-2 rounded-xl bg-amber-tint px-3.5 py-2.5 text-[12px] text-amber">{s.note}</div>}
      <div className="mt-3 grid gap-2">
        {a.decisions.map((d) => {
          const p = a.preflights?.[d.strategyId];
          return (
            <div key={d.strategyId} className="rounded-xl border border-line px-4 py-2.5 text-[12px]">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={verdictTone(d.verdict)}>{d.verdict.toUpperCase()}</Pill>
                <span className="font-semibold text-ink">{d.vault ?? d.strategyId}</span>
                {d.amount != null && d.verdict === "allocate" && <span className="font-display font-semibold text-ink">{d.amount.toLocaleString("en-US")} USDC</span>}
              </div>
              <div className="mt-1 text-body">{d.reason}</div>
              {p && (
                <div className="mt-1 text-[11px] text-faint">
                  Pre-flight {p.verdict} · deposit limit {p.depositLimitUnlimited ? "unlimited" : p.depositLimitUsd != null ? `${p.depositLimitUsd} USDC` : "?"} · NAV {utc(p.navUpdatedAt)} ({ageText(p.navAgeHours)}) · {chainInfo(p.chainId).name} block {p.blockNumber?.toLocaleString("en-US") ?? "?"}
                  {p.minLiveDepositUsd && p.minLiveDepositUsd > (p.minDepositUsd ?? 100) ? ` · Live minimum ${p.minLiveDepositUsd} USDC` : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {a.memo && (
        <details className="mt-3 text-[12px]">
          <summary className="cursor-pointer font-semibold text-ink">Allocation memo ({a.memo.sections.length} sections, written by SERV)</summary>
          <div className="mt-2 grid gap-2">
            {a.memo.sections.map((m) => (
              <div key={m.heading}>
                <div className="font-semibold text-ink">{m.heading}</div>
                <div className="text-body">{m.body}</div>
              </div>
            ))}
          </div>
        </details>
      )}
      {a.trace?.decision && (
        <details className="mt-2 text-[12px]">
          <summary className="cursor-pointer font-semibold text-ink">SERV decision · exact input and raw output</summary>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">Input (facts)</div>
              <Json value={a.trace.decision.input} max="max-h-96" />
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">Output</div>
              <Json value={a.trace.decision.output} max="max-h-96" />
            </div>
          </div>
        </details>
      )}
    </Card>
  );
}

function SimulationsCard({ s }: { s: EvidenceSnapshot }) {
  if (!s.simulations?.length) return null;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-display text-[16px] font-semibold text-ink">Simulated on mainnet · eth_call + state override</div>
        <SnapshotBadge s={s} />
      </div>
      <div className="mt-1 text-[12px] text-muted">Deposit and redeem calldata built by the IXS MCP, run against the real vault contracts from an empty wallet. Nothing is sent.</div>
      <div className="mt-3 grid gap-2">
        {s.simulations.map((m) => (
          <details key={m.label} className="rounded-xl border border-line px-4 py-2.5 text-[12px]">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2">
              <Pill tone={m.ok ? "green" : "amber"}>{m.ok ? "ok" : "no build / revert"}</Pill>
              <span className="font-semibold text-ink">{m.label}</span>
            </summary>
            <div className="mt-1 text-body">{m.summary}</div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <Json value={m.request} max="max-h-64" />
              <Json value={m.response} max="max-h-64" />
            </div>
          </details>
        ))}
      </div>
    </Card>
  );
}

type ForkVault = { vault: { symbol: string; address: string }; verdict: string; status: string; txs?: { step: string; hash: string; status: string }[]; redeem?: { status?: string; previewNetAssets?: number | null; tx?: { hash: string; status: string } }; redeemCheck?: { outcome?: string }; liveDepositMinimum?: { usd: number; formula: string } };
type ForkRun = { file?: string; label?: string; chain?: string; chainId?: number; forkBlock?: number; amount?: string; ranAt?: string; recordedAt?: string; relabelled?: string; vaults?: ForkVault[] };

function ForkCard({ r }: { r: ForkRun }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-display text-[16px] font-semibold text-ink">
          {r.chain} · {r.amount} · scripts/fork-demo.mjs
        </div>
        <Pill tone="blue">{r.label ?? `Mainnet fork (block ${r.forkBlock})`}</Pill>
      </div>
      <div className="mt-1 text-[12px] text-muted">
        Anvil fork of mainnet at block {r.forkBlock?.toLocaleString("en-US")} · {utc(r.ranAt ?? r.recordedAt)} · real IXS contracts and IXS MCP calldata, demo wallet funded on the fork only{r.file ? <> · <span className="mono">{r.file}</span></> : null}
      </div>
      <div className="mt-3 grid gap-2">
        {(r.vaults ?? []).map((v) => (
          <div key={v.vault.address} className="rounded-xl border border-line px-4 py-2.5 text-[12px]">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={verdictTone(v.verdict)}>{v.verdict}</Pill>
              <span className="font-semibold text-ink">{v.vault.symbol}</span>
              <span className="mono text-faint">{v.vault.address.slice(0, 10)}…</span>
            </div>
            <div className="mt-1 text-body">{v.status}</div>
            {v.redeem?.status && (
              <div className="mt-1 text-amber">
                Redeem: {v.redeem.status}
                {v.redeem.previewNetAssets != null ? ` · previewRedeem ${v.redeem.previewNetAssets.toFixed(4)} USDC net` : ""}
                {v.redeem.tx ? ` · fork tx ${v.redeem.tx.hash}` : ""}
              </div>
            )}
            {v.redeemCheck?.outcome && <div className="mt-1 text-muted">{v.redeemCheck.outcome}</div>}
            {v.txs?.map((t) => (
              <div key={t.hash} className="mono text-[11px] text-faint">
                {t.step} · {t.status} · fork tx {t.hash}
              </div>
            ))}
          </div>
        ))}
      </div>
      {r.relabelled && <div className="mt-2 text-[11px] text-faint">{r.relabelled}</div>}
      <details className="mt-2 text-[12px]">
        <summary className="cursor-pointer font-semibold text-ink">Raw JSON</summary>
        <Json value={r} max="max-h-96" />
      </details>
    </Card>
  );
}

function VaultTable({ d }: { d: EvidenceResponse }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-display text-[16px] font-semibold text-ink">Vaults now · deposit limit, NAV and last NAV change (read on-chain at request time)</div>
        <Pill tone={d.registrySource === "api" ? "green" : "amber"}>{d.registrySource === "api" ? "addresses from the IXS Vault API" : d.registrySource === "snapshot" ? "from the committed snapshot (live read failed)" : "last-known addresses (API unreachable)"}</Pill>
      </div>
      <div className="mt-3 overflow-x-auto">
        <div className="min-w-[1080px]">
          <div className="table-head" style={{ gridTemplateColumns: "1.3fr 1fr 1fr 1fr 1.2fr 1.3fr 1fr 1fr" }}>
            <span>Vault</span>
            <span>Settlement</span>
            <span>Deposit limit</span>
            <span>Price / share</span>
            <span>NAV updated</span>
            <span>Last NAV change tx</span>
            <span>Min deposit · fee</span>
            <span>Read block</span>
          </div>
          {d.vaults.map((raw) => {
            const vault = raw as {
              chainId: number; chain: string; address: string; explorer: string; symbol: string; settlement: string; requiresWhitelist: boolean; pricePerShare: number | null; readBlock: number | null; readAt: string;
              depositLimit: { usd: number | null; unlimited: boolean; source: string }; minDeposit: { usd: number; source: string }; redeemFeeBps: number | null;
              nav: { updatedAtIso: string | null; ageHours: number | null; block: number | null; lastChangeTx: string | null; lastChangeVerified: boolean; lastChangeExplorer: string | null; contractThresholdHours?: number | null };
            };
            const stale = vault.nav.contractThresholdHours != null && (vault.nav.ageHours ?? 0) > vault.nav.contractThresholdHours;
            return (
              <div key={vault.address} className="table-row text-ink" style={{ gridTemplateColumns: "1.3fr 1fr 1fr 1fr 1.2fr 1.3fr 1fr 1fr" }}>
                <div>
                  <div className="font-semibold">
                    {vault.symbol} · {vault.chain}
                  </div>
                  <a href={vault.explorer} target="_blank" rel="noreferrer" className="mono inline-flex items-center gap-1 text-[11px] font-normal text-blue-deep">
                    {vault.address.slice(0, 10)}… {Icons.external}
                  </a>
                  <div className="text-[11px] font-normal text-faint">{vault.requiresWhitelist ? "KYC whitelist" : "open"}</div>
                </div>
                <span className="text-[12px]">{vault.settlement}</span>
                <span className={cx("font-display font-semibold", !vault.depositLimit.unlimited && (vault.depositLimit.usd ?? 0) === 0 ? "text-amber" : "")}>
                  {vault.depositLimit.unlimited ? "unlimited" : vault.depositLimit.usd == null ? "?" : `${vault.depositLimit.usd} USDC`}
                  <div className="text-[10px] font-normal text-faint">{!vault.depositLimit.unlimited && (vault.depositLimit.usd ?? 0) === 0 ? "waiting NAV refresh → DEFER" : vault.depositLimit.source}</div>
                </span>
                <span className="font-display font-semibold">{vault.pricePerShare?.toFixed(6) ?? "—"}</span>
                <span className="text-[12px]">
                  {utc(vault.nav.updatedAtIso)}
                  <div className={cx("text-[11px]", stale || (vault.nav.ageHours ?? 0) > 72 ? "text-amber" : "text-faint")}>
                    {ageText(vault.nav.ageHours)}
                    {vault.nav.contractThresholdHours != null ? ` · contract threshold ${vault.nav.contractThresholdHours} h${stale ? " (exceeded)" : ""}` : ""}
                  </div>
                </span>
                <span className="text-[12px]">
                  {vault.nav.lastChangeTx ? (
                    <a href={vault.nav.lastChangeExplorer ?? "#"} target="_blank" rel="noreferrer" className="mono inline-flex items-center gap-1 text-blue-deep">
                      {vault.nav.lastChangeTx.slice(0, 12)}… {Icons.external}
                    </a>
                  ) : (
                    "—"
                  )}
                  <div className="text-[11px] text-faint">
                    {vault.nav.block ? `block ${vault.nav.block.toLocaleString("en-US")}` : ""} {vault.nav.lastChangeVerified ? "· receipt verified" : ""}
                  </div>
                </span>
                <span className="text-[12px]">
                  {vault.minDeposit.usd} USDC · {vault.redeemFeeBps != null ? `${vault.redeemFeeBps / 100}% redeem` : "fee n/a"}
                </span>
                <span className="text-[12px]">
                  {vault.readBlock?.toLocaleString("en-US") ?? "?"}
                  <div className="text-[11px] text-faint">{vault.readAt?.slice(11, 19)} UTC</div>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

export default function EvidencePage() {
  const q = useEvidence();
  const [kind, setKind] = useState<(typeof KINDS)[number]>("all");

  const exportJson = () => {
    if (!q.data) return;
    const blob = new Blob([JSON.stringify(q.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vaulto-evidence-${q.data.generatedAt.slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const d = q.data;
  const log = d ? d.log.filter((e) => kind === "all" || e.kind === kind) : [];

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-white px-6">
        <Link href="/" aria-label="Vaulto home">
          <VaultoLogo height={22} />
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/app" className="btn btn-soft h-9 text-[13px]">Open app</Link>
          <button className="btn btn-primary h-9 text-[13px]" onClick={exportJson} disabled={!d}>
            Export JSON
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-[1180px] px-4 py-7 sm:px-6">
        <div className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">Evidence</div>
        <div className="mt-1 text-[14px] text-muted">
          Everything Vaulto&apos;s decisions rest on: IXS MCP calls and responses, IXS Vault API and subgraph reads, on-chain reads with block numbers, eth_call simulations, SERV reasoning input and output, and the mainnet-fork runs. Public, refreshed every 30 s, exportable as JSON.
        </div>

        {q.isError && <ErrorState message={q.error.message} retry={() => q.refetch()} />}
        {!d && !q.isError && <Skeleton className="mt-5 h-96" />}

        {d && (
          <div className="mt-5 grid gap-5">
            <div className="rounded-xl border border-line bg-tint px-4 py-3 text-[13px] text-body">
              <b className="text-ink">Submission mode: {d.submission.label}. No Live deposit was executed.</b> {d.submission.note}
              <div className="mt-1 text-[12px] text-muted">
                Deployment: {d.deployment.source === "git" ? `built from git ${d.deployment.repo ?? ""}@${d.deployment.ref ?? ""} ${d.deployment.commit ?? ""}` : d.deployment.source}. Response generated {utc(d.generatedAt)}.
              </div>
            </div>

            <Card>
              <div className="font-display text-[16px] font-semibold text-ink">Statements Vaulto relies on</div>
              <ul className="mt-2 grid gap-1.5 text-[13px] text-body">
                {d.ixsStatements.map((s) => (
                  <li key={s.statement} className="flex gap-3">
                    <span className="w-[92px] shrink-0 font-semibold text-faint">{s.date}</span>
                    <span>
                      <b className="text-ink">{s.source}:</b> {s.statement}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 grid gap-1 text-[12px] text-muted sm:grid-cols-2">
                <div>IXS Vault API: <span className="mono text-ink">{d.sources.ixsApi}</span></div>
                <div>IXS MCP: <span className="mono text-ink">{d.sources.ixsMcp}</span></div>
                <div>BNB RPC: <span className="mono text-ink">{d.sources.rpcs["56"]}</span></div>
                <div>Avalanche RPC: <span className="mono text-ink">{d.sources.rpcs["43114"]}</span></div>
                <div>SERV reasoning: <span className="mono text-ink">OpenServ · {d.sources.openserv.model} · {d.sources.openserv.mode}</span></div>
              </div>
            </Card>

            <VaultTable d={d} />

            {d.snapshot ? (
              <>
                <ServCard s={d.snapshot} />
                <SimulationsCard s={d.snapshot} />
              </>
            ) : (
              <Card>
                <div className="text-[13px] text-muted">No committed snapshot found in evidence/.</div>
              </Card>
            )}

            {d.forkRuns.map((r) => (
              <ForkCard key={String((r as ForkRun).file ?? (r as ForkRun).forkBlock)} r={r as ForkRun} />
            ))}

            <div className="grid gap-5 md:grid-cols-2">
              <Card>
                <div className="font-display text-[16px] font-semibold text-ink">Next IXS cutoff</div>
                <div className="mt-2 text-[13px] text-body">
                  <b className="text-ink">{d.cutoff.nextCutoffSgt}</b> (in {d.cutoff.hoursUntilCutoff} h) · estimated settlement <b className="text-ink">{d.cutoff.estimatedSettlementSgt}</b>
                  {d.cutoff.skipped.length ? ` · skipping ${d.cutoff.skipped.map((s) => `${s.date} (${s.reason})`).join(", ")}` : ""}
                </div>
                <div className="mt-2 text-[12px] text-muted">
                  {d.cutoff.source}. {d.cutoff.holidayAssumption}.
                </div>
              </Card>
              <Card>
                <div className="font-display text-[16px] font-semibold text-ink">NAV / deposit-limit watcher</div>
                <div className="mt-2 text-[13px] text-body">
                  {d.watch.waiting.length ? d.watch.waiting.map((w) => `${w.chainName} ${w.symbol}: waiting NAV refresh (limit 0, NAV ${ageText(w.navAgeHours)})`).join(" · ") : "No vault waiting for a NAV refresh."}
                </div>
                <div className="mt-2 grid gap-1 text-[12px] text-muted">
                  {d.watch.events.length ? d.watch.events.slice(0, 5).map((e) => <div key={e.id}>{e.at.slice(0, 16).replace("T", " ")} · {e.message}</div>) : "No limit / NAV changes observed by this server instance yet."}
                </div>
              </Card>
            </div>

            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-display text-[16px] font-semibold text-ink">
                  Call log · {d.instanceLogCount} from this server instance + {d.log.length - d.instanceLogCount} from the committed snapshot
                </div>
                <div className="flex flex-wrap gap-1">
                  {KINDS.map((k) => (
                    <button key={k} onClick={() => setKind(k)} className={cx("rounded-lg px-2.5 py-1 text-[12px] font-semibold", kind === k ? "bg-blue text-white" : "bg-canvas text-muted hover:text-ink")}>
                      {k}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 grid gap-2">
                {log.map((e) => (
                  <details key={`${e.origin}-${e.id}`} className="rounded-xl border border-line px-4 py-2.5 text-[12px]">
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                      <Pill tone={e.ok ? (e.kind === "serv" ? "blue" : "green") : "red"} className="h-5 px-1.5 text-[10px] uppercase">
                        {e.kind}
                      </Pill>
                      <Pill tone="muted" className="h-5 px-1.5 text-[10px]">
                        {e.origin === "snapshot" ? "snapshot" : "this instance"}
                      </Pill>
                      <span className="font-semibold text-ink">{e.label}</span>
                      <span className="text-faint">
                        {e.at.slice(0, 10)} {e.at.slice(11, 19)} UTC{e.chainId ? ` · ${chainInfo(e.chainId).name}` : ""}
                        {e.blockNumber ? ` · block ${e.blockNumber.toLocaleString("en-US")}` : ""}
                        {e.durationMs != null ? ` · ${e.durationMs} ms` : ""}
                      </span>
                    </summary>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">Request</div>
                        <Json value={e.request} max="max-h-64" />
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">Response</div>
                        <Json value={e.response} max="max-h-64" />
                      </div>
                    </div>
                  </details>
                ))}
                {!log.length && <div className="text-[13px] text-muted">No entries of this kind.</div>}
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
