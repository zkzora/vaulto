"use client";

import { useRouter } from "next/navigation";
import { useAnalyze, useMainnetVaults, useSimulate, useStrategies, useTreasury } from "@/hooks/use-vaulto";
import { chainInfo, modeLabel } from "@/lib/chain/config";
import { fmtUsd } from "@/lib/format";
import type { VaultStrategy } from "@/lib/types";
import { Card, ErrorState, Icons, IxsMark, Pill, Skeleton, cx } from "@/components/ui";

const ageText = (h: number | null | undefined) => (h == null ? "unknown" : h < 48 ? `${h.toFixed(1)} h ago` : `${(h / 24).toFixed(1)} days ago`);

function VerdictPill({ verdict }: { verdict: "allocate" | "defer" | "reject" }) {
  return <Pill tone={verdict === "allocate" ? "green" : verdict === "defer" ? "amber" : "red"}>{verdict === "allocate" ? "ALLOCATE" : verdict === "defer" ? "DEFER · waiting NAV refresh" : "REJECT"}</Pill>;
}

function Facts({ s }: { s: VaultStrategy }) {
  const limit = s.depositLimitUsd === null || s.depositLimitUsd === undefined ? (s.depositLimitSource?.includes("2^256") ? "unlimited" : "unknown") : `${s.depositLimitUsd.toLocaleString("en-US")} ${s.asset}`;
  const chain = chainInfo(s.chainId);
  return (
    <div className="mt-4 grid gap-1.5 text-[12px] text-muted">
      <div className="flex justify-between gap-3">
        <span>Asset (asset() on-chain)</span>
        <span className="font-semibold text-ink">
          {s.asset} · {s.assetDecimals} dec
        </span>
      </div>
      <div className="flex justify-between gap-3">
        <span>Settlement</span>
        <span className="text-right font-semibold text-ink">{s.settlement === "sync" ? "Sync (ERC-4626)" : "Async (ERC-7540)"}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span>Deposit limit (maxDeposit)</span>
        <span className={cx("text-right font-semibold", s.depositLimitUsd === 0 ? "text-amber" : "text-ink")}>
          {limit}
          {s.depositLimitUsd === 0 ? " · waiting NAV refresh" : ""}
        </span>
      </div>
      <div className="flex justify-between gap-3">
        <span>NAV</span>
        <span className={cx("text-right font-semibold", (s.nav?.ageHours ?? 0) > 72 ? "text-amber" : "text-ink")}>
          {s.nav?.pricePerShare != null ? `${s.nav.pricePerShare.toFixed(6)} / share` : "—"} · {ageText(s.nav?.ageHours)}
        </span>
      </div>
      {s.nav?.lastChangeTx && (
        <div className="flex justify-between gap-3">
          <span>Last NAV change</span>
          <a href={`${chain.explorer}/tx/${s.nav.lastChangeTx}`} target="_blank" rel="noreferrer" className="mono inline-flex items-center gap-1 text-blue-deep">
            {s.nav.lastChangeTx.slice(0, 10)}… {s.nav.block ? `· block ${s.nav.block.toLocaleString("en-US")}` : ""} {Icons.external}
          </a>
        </div>
      )}
      {s.tvlUsd != null && (
        <div className="flex justify-between gap-3">
          <span>Vault TVL (totalAssets)</span>
          <span className="font-semibold text-ink">{fmtUsd(s.tvlUsd, { decimals: 2 })}</span>
        </div>
      )}
      {s.terms && (
        <>
          <div className="flex justify-between gap-3">
            <span>Minimum deposit</span>
            <span className="font-semibold text-ink">
              {s.terms.minDepositUsd} {s.asset} · confirmed by IXS
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Fees</span>
            <span className="text-right font-semibold text-ink">
              {s.terms.depositFeeBps / 100}% deposit · {s.terms.redeemFeeBps != null ? `${s.terms.redeemFeeBps / 100}% redeem (feeBps on-chain)` : "redeem fee not exposed"}
            </span>
          </div>
        </>
      )}
      <div className="flex justify-between gap-3">
        <span className="shrink-0">Cutoff</span>
        <span className="text-right font-semibold text-ink">{s.settlement === "sync" ? "n/a · settles in the deposit tx" : "17:00 SGT, SG business days (IXS, 24 Sep 2026)"}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="shrink-0">Redemption</span>
        <span className="text-right font-semibold text-ink">
          requested → awaiting RWA sale &amp; operator finalization → paid · no claim step{s.terms?.minRedeemUsd != null ? (s.terms.minRedeemUsd >= 0.01 ? ` · min ${s.terms.minRedeemUsd} ${s.asset} net (minRedeemAssets)` : " · no practical minimum (minRedeemAssets ≈ 0)") : ""}
        </span>
      </div>
      {s.nav?.contractThresholdHours != null && (
        <div className="flex justify-between gap-3">
          <span>NAV staleness threshold (contract)</span>
          <span className="font-semibold text-ink">{s.nav.contractThresholdHours >= 48 ? `${(s.nav.contractThresholdHours / 24).toFixed(0)} days` : `${s.nav.contractThresholdHours} h`} · Vaulto policy 72 h</span>
        </div>
      )}
      <div className="flex justify-between gap-3">
        <span>Eligibility</span>
        <span className={cx("font-semibold", s.requiresWhitelist ? "text-amber" : "text-green")}>{s.requiresWhitelist ? "KYC whitelist required" : "Open"}</span>
      </div>
    </div>
  );
}

export default function VaultsPage() {
  const q = useStrategies();
  const treasury = useTreasury();
  const mainnet = useMainnetVaults();
  const analyze = useAnalyze();
  const simulate = useSimulate();
  const router = useRouter();

  if (q.isError) return <ErrorState message={q.error.message} retry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const { strategies, liveOk, registry } = q.data;
  const positions = new Map(treasury.data?.snapshot.positions.map((p) => [p.strategyId, p]) ?? []);
  const snapshot = treasury.data?.snapshot;
  const waiting = treasury.data?.watch.waiting ?? [];

  const allocate = async () => {
    await analyze.mutateAsync();
    router.push("/app/strategy");
  };

  return (
    <div className="grid content-start gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">IXS Strategies</div>
          <div className="mt-1 text-[14px] text-muted">
            The IX High Yield Bond vaults on BNB Chain and Avalanche mainnet. Addresses from the IXS Vault API; asset, decimals, fees, limits and NAV read from the contracts and the IXS subgraphs; deposits built by the IXS MCP.
          </div>
        </div>
        <button className="btn btn-primary" disabled={analyze.isPending} onClick={allocate}>
          {analyze.isPending && <span className="spinner" />}
          {analyze.isPending ? "Analyzing…" : "Allocate with Vaulto"}
        </button>
      </div>

      {waiting.length > 0 && (
        <div className="rounded-xl border border-amber-line bg-amber-tint px-4 py-3 text-[13px] text-amber">
          <b>NAV / deposit-limit watcher:</b> {waiting.map((w) => `${w.chainName} ${w.symbol} is temporarily paused — waiting NAV refresh (limit 0, NAV ${ageText(w.navAgeHours)})`).join(" · ")}. Vaulto re-checks on every scan and will flag the vault the moment its limit is above 0.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {strategies.map((s) => {
          const p = positions.get(s.id);
          const announced = s.availability === "announced";
          const chain = chainInfo(s.chainId);
          const mode = snapshot?.liveChainIds.includes(s.chainId) ? "live" : "simulated";
          const sim = simulate.data?.strategyId === s.id ? simulate.data : null;
          return (
            <Card key={s.id} className={cx("flex flex-col", s.tag === "primary" && "card-accent", announced && "opacity-90")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <IxsMark size={24} />
                  <Pill tone={s.tag === "primary" ? "blue" : s.tag === "opportunity" ? "amber" : announced ? "muted" : "green"} className="uppercase tracking-[0.04em]">
                    {s.tag === "primary" ? "Primary" : announced ? "Announced" : s.tag === "opportunity" ? "Licensed" : "Open"}
                  </Pill>
                  {!announced && <Pill tone="muted">{chain.name}</Pill>}
                </div>
                <Pill tone={s.status === "active" ? "green" : "muted"}>{announced ? "not deployed" : s.status}</Pill>
              </div>
              <div className="mt-3 font-display text-[18px] font-semibold leading-tight text-ink">{s.vaultName}</div>
              <div className="mt-0.5 text-[12px] font-medium text-muted">{s.assetType}</div>
              <div className="mt-2.5 text-[13px] leading-[1.55] text-body">{s.description}</div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="stat-tile">
                  <div className="text-[11px] font-medium text-muted">{announced ? "APY" : "Yield"}</div>
                  <div className="mt-1 font-display text-[18px] font-semibold text-ink">{announced ? "4–12%" : s.apy != null ? `${s.apy}%` : "—"}</div>
                  <div className="text-[10px] text-faint">{announced ? "indicative (IXS)" : (s.apyNote ?? "")}</div>
                </div>
                <div className="stat-tile">
                  <div className="text-[11px] font-medium text-muted">Risk score</div>
                  <div className="mt-1 font-display text-[18px] font-semibold text-green">{announced ? "—" : s.riskScore}</div>
                </div>
                <div className="stat-tile">
                  <div className="text-[11px] font-medium text-muted">Liquidity</div>
                  <div className="mt-1 text-[12px] font-semibold text-ink">{s.liquidity}</div>
                </div>
              </div>
              {announced ? (
                <div className="mt-4 text-[12px] text-muted">Asset BTC · no contract on the IXS Vault API · Vaulto checks availability on every analysis.</div>
              ) : (
                <Facts s={s} />
              )}
              {!announced && (
                <div className="mt-2 flex justify-between gap-3 text-[12px] text-muted">
                  <span>Your position</span>
                  <span className="font-semibold text-ink">{p ? fmtUsd(p.valueUsd) : "—"}</span>
                </div>
              )}
              {s.executable && (
                <div className="mt-4 rounded-xl border border-line bg-canvas px-3.5 py-3 text-[12px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink">
                      {modeLabel("simulated", s.chainId, snapshot?.onchain.byChain?.[s.chainId]?.rpcKind ?? "mainnet")} · {s.terms?.minDepositUsd ?? 100} {s.asset}
                    </span>
                    <div className="flex gap-1.5">
                      <button className="btn btn-soft h-8 text-[12px]" disabled={simulate.isPending} onClick={() => simulate.mutate({ strategyId: s.id })}>
                        {simulate.isPending && simulate.variables?.strategyId === s.id && simulate.variables?.action !== "redeem" ? "Checking…" : "Pre-flight + simulate"}
                      </button>
                      {s.settlement === "sync" && (
                        <button className="btn btn-soft h-8 text-[12px]" disabled={simulate.isPending} onClick={() => simulate.mutate({ strategyId: s.id, action: "redeem", shares: p?.shares && p.shares > 0 ? p.shares : s.sharePrice ? Math.ceil(((s.terms?.minRedeemUsd ?? 100) / (1 - (s.terms?.redeemFeeBps ?? 50) / 10_000) / s.sharePrice) * 1e4) / 1e4 : 100 })} title="Simulate requestRedeem for your position (or the minimum redeemable amount)">
                          {simulate.isPending && simulate.variables?.strategyId === s.id && simulate.variables?.action === "redeem" ? "Checking…" : "Simulate redeem"}
                        </button>
                      )}
                    </div>
                  </div>
                  {simulate.variables?.strategyId === s.id && simulate.isError && <div className="mt-2 text-red">{simulate.error.message}</div>}
                  {sim && sim.action === "redeem" && sim.redeem && (
                    <div className="mt-2 grid gap-1 text-muted">
                      <div className="flex items-center gap-2">
                        <Pill tone={sim.redeem.ok ? "green" : "red"}>{sim.redeem.ok ? "requestRedeem OK" : "requestRedeem reverts"}</Pill>
                        <span className="text-faint">{sim.redeem.shares.toFixed(4)} {s.shareSymbol} · block {sim.redeem.block?.toLocaleString("en-US") ?? "?"}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span>USDC received (previewRedeem, net of {((sim.feeBps ?? 0) / 100).toFixed(2)}% fee)</span>
                        <span className="font-semibold text-ink">{sim.redeem.netAssets?.toFixed(4) ?? "—"} {s.asset}{sim.redeem.grossAssets != null ? ` (gross ${sim.redeem.grossAssets.toFixed(4)}, fee ${sim.redeem.feeAssets?.toFixed(4)})` : ""}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span>Result</span>
                        <span className={cx("text-right font-semibold", sim.redeem.ok ? "text-green" : "text-red")}>{sim.redeem.ok ? `queued${sim.redeem.requestId ? ` · request #${sim.redeem.requestId}` : ""} · awaiting RWA sale & operator finalization → paid` : `revert: ${sim.redeem.revertReason}`}</span>
                      </div>
                      <div className="text-faint">{sim.mcpDescription} · minimum {sim.minRedeemUsd ?? "?"} {s.asset} net · override: {sim.redeem.overrides.join(", ") || "none"}</div>
                    </div>
                  )}
                  {sim && sim.action !== "redeem" && sim.preflight && (
                    <div className="mt-2 grid gap-1.5 text-muted">
                      <div className="flex items-center gap-2">
                        <VerdictPill verdict={sim.verdict} />
                        <span className="text-faint">wallet {sim.preflight.wallet.slice(0, 8)}… · block {sim.preflight.blockNumber?.toLocaleString("en-US") ?? "?"}</span>
                      </div>
                      {sim.preflight.checks.map((c) => (
                        <div key={c.key} className="flex justify-between gap-2">
                          <span>
                            <span className={cx("mr-1 font-semibold", c.ok ? "text-green" : c.severity === "info" ? "text-faint" : c.severity === "defer" ? "text-amber" : "text-red")}>{c.ok ? "✓" : c.severity === "info" ? "·" : "✗"}</span>
                            {c.label}
                          </span>
                          <span className="text-right text-ink" title={`${c.detail} · ${c.source}`}>
                            {c.value}
                          </span>
                        </div>
                      ))}
                      {sim.steps.map((st) => (
                        <div key={st.index} className="flex justify-between gap-2 border-t border-line-3 pt-1.5">
                          <span className="capitalize">
                            {st.kind} · {st.builtBy === "ixs-mcp" ? "IXS MCP" : "direct vault ABI"}
                          </span>
                          <span className={cx("text-right font-semibold", st.simulation?.ok ? "text-green" : "text-red")}>
                            {st.simulation?.ok
                              ? st.simulation.expectedShares != null
                                ? `${st.simulation.expectedShares.toFixed(4)} ${st.simulation.shareSymbol}`
                                : st.simulation.requestId
                                  ? `request #${st.simulation.requestId} · pending operator settlement`
                                  : "ok"
                              : `revert: ${st.simulation?.revertReason ?? "unknown"}`}
                          </span>
                        </div>
                      ))}
                      {sim.note && <div className="text-amber">{sim.note}</div>}
                      <div className="text-faint">{sim.steps.length ? "eth_call + state override (balance + allowance) · nothing is sent" : "no calldata built"}</div>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
                <Pill tone={s.executable ? (s.depositLimitUsd === 0 ? "amber" : "green") : "muted"}>
                  {s.executable ? (s.depositLimitUsd === 0 ? "Temporarily paused · waiting NAV refresh" : `Executable · IXS MCP · ${mode === "live" ? "Live" : "Simulated"}`) : (s.capacityNote ?? "Not executable")}
                </Pill>
                {s.explorerUrl && (
                  <a href={s.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-blue-deep">
                    Contract {Icons.external}
                  </a>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-display text-[16px] font-semibold text-ink">IXS production vaults · IX High Yield Bond</div>
          <div className="flex items-center gap-2">
            <Pill tone={registry.source === "api" ? "green" : "amber"}>{registry.source === "api" ? "addresses from api-v2.ixs.finance" : "IXS API unreachable · last-known addresses"}</Pill>
            <Pill tone={registry.onchainOk ? "green" : "amber"}>{registry.onchainOk ? "contract state read on-chain" : "RPC unavailable"}</Pill>
          </div>
        </div>
        <div className="mt-1 text-[13px] text-muted">
          Every vault the IXS Vault API lists (BNB Chain and Avalanche). TVL and price per share are read on-chain.
          {!liveOk && " IXS API unreachable, showing cached data."}
        </div>
        <div className="mt-4 overflow-x-auto">
          <div className="min-w-[860px]">
            <div className="table-head" style={{ gridTemplateColumns: "1.5fr 1fr .7fr .8fr 1fr 1fr 1fr 1fr" }}>
              <span>Vault</span>
              <span>Chain</span>
              <span>Asset</span>
              <span>Yield</span>
              <span>TVL (on-chain)</span>
              <span>Whitelist</span>
              <span>Vaulto</span>
              <span>Contract</span>
            </div>
            {(mainnet.data?.vaults ?? []).map((v) => {
              const target = strategies.find((s) => s.routeId === v.routeId);
              return (
                <div key={v.routeId} className={cx("table-row text-ink", target && "bg-tint-2")} style={{ gridTemplateColumns: "1.5fr 1fr .7fr .8fr 1fr 1fr 1fr 1fr" }}>
                  <div>
                    <div className="font-semibold">{v.name}</div>
                    <div className="text-[11px] font-normal text-faint">
                      {v.status}
                      {v.sharePrice != null ? ` · ${v.sharePrice.toFixed(4)} per share` : ""}
                    </div>
                  </div>
                  <span>{v.chainName}</span>
                  <span>{v.asset}</span>
                  <span className="font-display font-semibold">{v.apy != null ? `${v.apy}%` : "—"}</span>
                  <span className="font-display font-semibold">{v.tvlUsd != null ? fmtUsd(v.tvlUsd) : "—"}</span>
                  <span className={v.requiresWhitelist ? "text-amber" : "text-green"}>{v.requiresWhitelist ? "Required" : "Open"}</span>
                  <span className="text-[12px]">{target ? target.vaultName : "—"}</span>
                  <a href={v.explorerUrl} target="_blank" rel="noreferrer" className="mono inline-flex items-center gap-1 text-blue-deep">
                    {v.contractAddress.slice(0, 8)}… {Icons.external}
                  </a>
                </div>
              );
            })}
            {mainnet.isPending && <Skeleton className="mt-3 h-24" />}
            {mainnet.data && !mainnet.data.vaults.length && <div className="py-6 text-center text-[13px] text-muted">No vaults returned by the IXS API.</div>}
          </div>
        </div>
      </Card>
    </div>
  );
}
