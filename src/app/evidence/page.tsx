"use client";

import Link from "next/link";
import { useState } from "react";
import { useEvidence } from "@/hooks/use-vaulto";
import { chainInfo } from "@/lib/chain/config";
import { Card, ErrorState, Icons, Pill, Skeleton, VaultoLogo, cx } from "@/components/ui";

const KINDS = ["all", "mcp", "ixs-api", "subgraph", "onchain", "simulation", "serv", "fork"] as const;

const ageText = (h: number | null | undefined) => (h == null ? "unknown" : h < 48 ? `${h.toFixed(1)} h ago` : `${(h / 24).toFixed(1)} days ago`);

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

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-white px-6">
        <Link href="/" aria-label="Vaulto home">
          <VaultoLogo height={22} />
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/app" className="btn btn-soft h-9 text-[13px]">Open app</Link>
          <button className="btn btn-primary h-9 text-[13px]" onClick={exportJson} disabled={!q.data}>
            Export JSON
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-[1180px] px-4 py-7 sm:px-6">
        <div className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">Evidence</div>
        <div className="mt-1 text-[14px] text-muted">
          Everything Vaulto&apos;s decisions rest on: IXS MCP calls and responses, IXS Vault API and subgraph reads, on-chain reads with block numbers, eth_call simulations, SERV reasoning input/output and the mainnet-fork run. Public, refreshed every 30 s, exportable as JSON.
        </div>

        {q.isError && <ErrorState message={q.error.message} retry={() => q.refetch()} />}
        {!q.data && !q.isError && <Skeleton className="mt-5 h-96" />}

        {q.data && (
          <div className="mt-5 grid gap-5">
            <Card>
              <div className="font-display text-[16px] font-semibold text-ink">IXS statements Vaulto relies on</div>
              <ul className="mt-2 grid gap-1.5 text-[13px] text-body">
                {q.data.ixsStatements.map((s) => (
                  <li key={s.statement} className="flex gap-3">
                    <span className="shrink-0 font-semibold text-faint">{s.date}</span>
                    <span>{s.statement}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 grid gap-1 text-[12px] text-muted sm:grid-cols-2">
                <div>IXS Vault API: <span className="mono text-ink">{q.data.sources.ixsApi}</span></div>
                <div>IXS MCP: <span className="mono text-ink">{q.data.sources.ixsMcp}</span></div>
                <div>BNB RPC: <span className="mono text-ink">{q.data.sources.rpcs["56"]}</span></div>
                <div>Avalanche RPC: <span className="mono text-ink">{q.data.sources.rpcs["43114"]}</span></div>
                <div>SERV reasoning: <span className="mono text-ink">OpenServ · {q.data.sources.openserv.model} · {q.data.sources.openserv.mode}</span></div>
                <div>Generated: <span className="mono text-ink">{q.data.generatedAt}</span></div>
              </div>
            </Card>

            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-display text-[16px] font-semibold text-ink">Vaults · deposit limit, NAV and last NAV change (on-chain)</div>
                <Pill tone={q.data.registrySource === "api" ? "green" : "amber"}>{q.data.registrySource === "api" ? "addresses from the IXS Vault API" : "last-known addresses (API unreachable)"}</Pill>
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
                  {q.data.vaults.map((v) => {
                    const vault = v as {
                      chainId: number; chain: string; address: string; explorer: string; symbol: string; settlement: string; requiresWhitelist: boolean; pricePerShare: number | null; readBlock: number | null; readAt: string;
                      depositLimit: { usd: number | null; unlimited: boolean; source: string }; minDeposit: { usd: number; source: string }; redeemFeeBps: number | null;
                      nav: { updatedAtIso: string | null; ageHours: number | null; block: number | null; lastChangeTx: string | null; lastChangeVerified: boolean; lastChangeExplorer: string | null; source: string };
                    };
                    return (
                      <div key={vault.address} className="table-row text-ink" style={{ gridTemplateColumns: "1.3fr 1fr 1fr 1pr 1.2fr 1.3fr 1fr 1fr".replace("1pr", "1fr") }}>
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
                          <div className="text-[10px] font-normal text-faint">{vault.depositLimit.source}</div>
                        </span>
                        <span className="font-display font-semibold">{vault.pricePerShare?.toFixed(6) ?? "—"}</span>
                        <span className="text-[12px]">
                          {vault.nav.updatedAtIso ? vault.nav.updatedAtIso.slice(0, 16).replace("T", " ") + " UTC" : "unknown"}
                          <div className={cx("text-[11px]", (vault.nav.ageHours ?? 0) > 72 ? "text-amber" : "text-faint")}>{ageText(vault.nav.ageHours)}</div>
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
                          <div className="text-[11px] text-faint">{vault.readAt.slice(11, 19)} UTC</div>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>

            <div className="grid gap-5 md:grid-cols-2">
              <Card>
                <div className="font-display text-[16px] font-semibold text-ink">Next IXS cutoff</div>
                <div className="mt-2 text-[13px] text-body">
                  <b className="text-ink">{q.data.cutoff.nextCutoffSgt}</b> (in {q.data.cutoff.hoursUntilCutoff} h) · estimated settlement <b className="text-ink">{q.data.cutoff.estimatedSettlementSgt}</b>
                  {q.data.cutoff.skipped.length ? ` · skipping ${q.data.cutoff.skipped.map((s) => `${s.date} (${s.reason})`).join(", ")}` : ""}
                </div>
                <div className="mt-2 text-[12px] text-muted">{q.data.cutoff.source}. {q.data.cutoff.holidayAssumption}.</div>
              </Card>
              <Card>
                <div className="font-display text-[16px] font-semibold text-ink">NAV / deposit-limit watcher</div>
                <div className="mt-2 text-[13px] text-body">
                  {q.data.watch.waiting.length ? q.data.watch.waiting.map((w) => `${w.chainName} ${w.symbol}: waiting NAV refresh (limit 0, NAV ${ageText(w.navAgeHours)})`).join(" · ") : "No vault waiting for a NAV refresh."}
                </div>
                <div className="mt-2 grid gap-1 text-[12px] text-muted">
                  {q.data.watch.events.length ? q.data.watch.events.slice(0, 5).map((e) => <div key={e.id}>{e.at.slice(0, 16).replace("T", " ")} · {e.message}</div>) : "No limit / NAV changes observed since the server started."}
                </div>
              </Card>
            </div>

            {[
              ["BNB Chain", q.data.forkRun],
              ["Avalanche C-Chain", q.data.forkRunAvalanche],
            ]
              .filter(([, run]) => run)
              .map(([chain, run]) => {
                const r = run as { label?: string; forkBlock?: number; vaults?: { vault: { symbol: string; address: string }; verdict: string; status: string; txs?: { step: string; hash: string; status: string }[] }[] };
                return (
                  <Card key={String(chain)}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-display text-[16px] font-semibold text-ink">Mainnet fork run (Anvil) · {String(chain)} · scripts/fork-demo.mjs</div>
                      <Pill tone="blue">
                        {r.label ?? "Mainnet fork"} · block {r.forkBlock?.toLocaleString("en-US")}
                      </Pill>
                    </div>
                    <div className="mt-3 grid gap-2">
                      {(r.vaults ?? []).map((v) => (
                        <div key={v.vault.address} className="rounded-xl border border-line px-4 py-2.5 text-[12px]">
                          <div className="flex flex-wrap items-center gap-2">
                            <Pill tone={v.verdict === "ALLOCATE" ? "green" : v.verdict === "DEFER" ? "amber" : "red"}>{v.verdict}</Pill>
                            <span className="font-semibold text-ink">{v.vault.symbol}</span>
                            <span className="mono text-faint">{v.vault.address.slice(0, 10)}…</span>
                          </div>
                          <div className="mt-1 text-muted">{v.status}</div>
                          {v.txs?.map((t) => (
                            <div key={t.hash} className="mono text-[11px] text-faint">
                              {t.step} · {t.status} · fork tx {t.hash}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                    <details className="mt-3 text-[12px]">
                      <summary className="cursor-pointer font-semibold text-ink">Raw JSON</summary>
                      <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-canvas p-4 text-[11px] text-muted">{JSON.stringify(run, null, 2)}</pre>
                    </details>
                  </Card>
                );
              })}

            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-display text-[16px] font-semibold text-ink">Call log · {q.data.log.length} entries</div>
                <div className="flex flex-wrap gap-1">
                  {KINDS.map((k) => (
                    <button key={k} onClick={() => setKind(k)} className={cx("rounded-lg px-2.5 py-1 text-[12px] font-semibold", kind === k ? "bg-blue text-white" : "bg-canvas text-muted hover:text-ink")}>
                      {k}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 grid gap-2">
                {q.data.log
                  .filter((e) => kind === "all" || e.kind === kind)
                  .map((e) => (
                    <details key={e.id} className="rounded-xl border border-line px-4 py-2.5 text-[12px]">
                      <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                        <Pill tone={e.ok ? (e.kind === "serv" ? "blue" : "green") : "red"} className="h-5 px-1.5 text-[10px] uppercase">
                          {e.kind}
                        </Pill>
                        <span className="font-semibold text-ink">{e.label}</span>
                        <span className="text-faint">
                          {e.at.slice(11, 19)} UTC{e.chainId ? ` · ${chainInfo(e.chainId).name}` : ""}
                          {e.blockNumber ? ` · block ${e.blockNumber.toLocaleString("en-US")}` : ""}
                          {e.durationMs != null ? ` · ${e.durationMs} ms` : ""}
                        </span>
                      </summary>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">Request</div>
                          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-canvas p-2 text-[11px] text-muted">{JSON.stringify(e.request, null, 1)}</pre>
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">Response</div>
                          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-canvas p-2 text-[11px] text-muted">{JSON.stringify(e.response, null, 1)}</pre>
                        </div>
                      </div>
                    </details>
                  ))}
                {!q.data.log.length && <div className="text-[13px] text-muted">No calls recorded yet. Open the app and run an analysis.</div>}
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
