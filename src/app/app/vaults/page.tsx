"use client";

import { useRouter } from "next/navigation";
import { useAnalyze, useMainnetVaults, useSimulate, useStrategies, useTreasury } from "@/hooks/use-vaulto";
import { CHAIN_ID, CHAIN_NAME, MODE_LABEL } from "@/lib/chain/config";
import { fmtUsd } from "@/lib/format";
import { Card, ErrorState, Icons, IxsMark, Pill, Skeleton, cx } from "@/components/ui";

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
  const mode = treasury.data?.snapshot.executionMode ?? "simulated";
  const rpcKind = treasury.data?.snapshot.onchain.rpcKind ?? "mainnet";
  const modeLabel = mode === "live" ? MODE_LABEL.live : rpcKind === "fork" ? MODE_LABEL.fork : MODE_LABEL.simulated;

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
            The IX High Yield Bond vaults on {CHAIN_NAME} mainnet. Addresses from the IXS Vault API; asset, decimals, fees and whitelist state read from the contracts; deposits built by the IXS MCP.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={mode === "live" ? "green" : rpcKind === "fork" ? "blue" : "amber"}>{modeLabel}</Pill>
          <button className="btn btn-primary" disabled={analyze.isPending} onClick={allocate}>
            {analyze.isPending && <span className="spinner" />}
            {analyze.isPending ? "Analyzing…" : "Allocate with Vaulto"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {strategies.map((s) => {
          const p = positions.get(s.id);
          const announced = s.availability === "announced";
          return (
            <Card key={s.id} className={cx("flex flex-col", s.tag === "primary" && "card-accent", announced && "opacity-90")}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <IxsMark size={24} />
                  <Pill tone={s.tag === "primary" ? "blue" : s.tag === "opportunity" ? "amber" : announced ? "muted" : "green"} className="uppercase tracking-[0.04em]">
                    {s.tag === "primary" ? "IXS official" : announced ? "Announced" : s.tag === "opportunity" ? "Licensed" : s.tag}
                  </Pill>
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
              <div className="mt-4 grid gap-1.5 text-[12px] text-muted">
                <div className="flex justify-between">
                  <span>Asset (asset() on-chain)</span>
                  <span className="font-semibold text-ink">
                    {s.asset}
                    {s.assetDecimals != null ? ` · ${s.assetDecimals} dec` : ""}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Settlement</span>
                  <span className="font-semibold text-ink">{announced ? "—" : s.settlement === "sync" ? "Sync (ERC-4626)" : "Async (ERC-7540)"}</span>
                </div>
                {s.tvlUsd != null && (
                  <div className="flex justify-between">
                    <span>Vault TVL (totalAssets)</span>
                    <span className="font-semibold text-ink">{fmtUsd(s.tvlUsd, { decimals: 2 })}</span>
                  </div>
                )}
                {s.sharePrice != null && (
                  <div className="flex justify-between">
                    <span>Price per share</span>
                    <span className="font-semibold text-ink">{s.sharePrice.toFixed(4)}</span>
                  </div>
                )}
                {s.terms && (
                  <>
                    <div className="flex justify-between">
                      <span>Minimum deposit</span>
                      <span className="font-semibold text-ink">{s.terms.minDepositUsd} {s.asset} · enforced on-chain</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Fees</span>
                      <span className="font-semibold text-ink">
                        {s.terms.depositFeeBps / 100}% deposit · {s.terms.redeemFeeBps != null ? `${s.terms.redeemFeeBps / 100}% redeem (feeBps on-chain)` : "redeem fee not exposed"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="shrink-0">Redemption</span>
                      <span className="text-right font-semibold text-ink">{s.terms.redemption}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between">
                  <span>Eligibility</span>
                  <span className={cx("font-semibold", announced ? "text-muted" : s.requiresWhitelist ? "text-amber" : "text-green")}>{announced ? "n/a" : s.requiresWhitelist ? "KYC whitelist required" : "Open"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Your position</span>
                  <span className="font-semibold text-ink">{p ? fmtUsd(p.valueUsd) : "—"}</span>
                </div>
              </div>
              {s.executable && (
                <div className="mt-4 rounded-xl border border-line bg-canvas px-3.5 py-3 text-[12px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink">
                      {rpcKind === "fork" ? MODE_LABEL.fork : MODE_LABEL.simulated} · {s.terms?.minDepositUsd ?? 100} {s.asset}
                    </span>
                    <button className="btn btn-soft h-8 text-[12px]" disabled={simulate.isPending} onClick={() => simulate.mutate({ strategyId: s.id })}>
                      {simulate.isPending && simulate.variables?.strategyId === s.id ? "Simulating…" : "Simulate deposit"}
                    </button>
                  </div>
                  {simulate.variables?.strategyId === s.id && simulate.isError && <div className="mt-2 text-red">{simulate.error.message}</div>}
                  {simulate.data?.strategyId === s.id && (
                    <div className="mt-2 grid gap-1 text-muted">
                      {simulate.data.mcpRefused ? (
                        <div className="text-amber">IXS MCP refused to build the deposit: {simulate.data.mcpRefused}</div>
                      ) : (
                        simulate.data.steps.map((st) => (
                          <div key={st.index} className="flex justify-between gap-2">
                            <span className="capitalize">
                              {st.kind} · {st.builtBy === "ixs-mcp" ? "IXS MCP" : "local ERC-4626"}
                            </span>
                            <span className={cx("text-right font-semibold", st.simulation?.ok ? "text-green" : "text-red")}>
                              {st.simulation?.ok
                                ? st.simulation.expectedShares != null
                                  ? `${st.simulation.expectedShares.toFixed(4)} ${st.simulation.shareSymbol}`
                                  : st.simulation.requestId
                                    ? `request #${st.simulation.requestId}`
                                    : "ok"
                                : `revert: ${st.simulation?.revertReason ?? "unknown"}`}
                            </span>
                          </div>
                        ))
                      )}
                      {simulate.data.note && <div className="text-amber">{simulate.data.note}</div>}
                      <div className="text-faint">eth_call + state override (balance + allowance) · nothing is sent</div>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
                <Pill tone={s.executable ? "green" : "muted"}>{s.executable ? `Executable · IXS MCP · ${mode === "live" ? "Live" : "Simulated"}` : (s.capacityNote ?? "Not executable")}</Pill>
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
          Every vault the IXS Vault API lists (BNB Chain and Avalanche). Vaulto targets the {CHAIN_NAME} vaults; the Avalanche ones are shown for context only. TVL and price per share are read on-chain.
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
                  <span className="text-[12px]">{target ? (v.chainId === CHAIN_ID ? target.vaultName : "—") : v.chainId === CHAIN_ID ? "—" : "read-only"}</span>
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
