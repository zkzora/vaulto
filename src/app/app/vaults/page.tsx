"use client";

import { useRouter } from "next/navigation";
import { useAnalyze, useStrategies, useTreasury } from "@/hooks/use-vaulto";
import { CHAIN_NAME, IXS_USDC_SYMBOL } from "@/lib/chain/config";
import { fmtUsd } from "@/lib/format";
import { Card, ErrorState, Icons, IxsMark, Pill, Skeleton, cx } from "@/components/ui";

export default function VaultsPage() {
  const q = useStrategies();
  const treasury = useTreasury();
  const analyze = useAnalyze();
  const router = useRouter();

  if (q.isError) return <ErrorState message={q.error.message} retry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const { strategies, liveOk, liveVaults } = q.data;
  const positions = new Map(treasury.data?.snapshot.positions.map((p) => [p.strategyId, p]) ?? []);

  const allocate = async () => {
    await analyze.mutateAsync();
    router.push("/app/strategy");
  };

  return (
    <div className="grid content-start gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">IXS Strategies</div>
          <div className="mt-1 text-[14px] text-muted">Every strategy is a live IXS vault on {CHAIN_NAME}, read through the IXS Vault API and MCP · deposits built by the IXS MCP and signed by your wallet</div>
        </div>
        <button className="btn btn-primary" disabled={analyze.isPending} onClick={allocate}>
          {analyze.isPending && <span className="spinner" />}
          {analyze.isPending ? "Analyzing…" : "Allocate with Vaulto"}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {strategies.map((s) => {
          const p = positions.get(s.id);
          return (
            <Card key={s.id} className={cx("flex flex-col", s.tag === "primary" && "card-accent")}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <IxsMark size={24} />
                  <Pill tone={s.tag === "primary" ? "blue" : s.tag === "secondary" ? "green" : "amber"} className="uppercase tracking-[0.04em]">
                    {s.tag === "primary" ? "IXS official" : s.tag}
                  </Pill>
                </div>
                <Pill tone={s.status === "active" ? "green" : "muted"}>{s.status}</Pill>
              </div>
              <div className="mt-3 font-display text-[18px] font-semibold leading-tight text-ink">{s.vaultName}</div>
              <div className="mt-0.5 text-[12px] font-medium text-muted">{s.assetType}</div>
              <div className="mt-2.5 text-[13px] leading-[1.55] text-body">{s.description}</div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="stat-tile">
                  <div className="text-[11px] font-medium text-muted">APY</div>
                  <div className="mt-1 font-display text-[18px] font-semibold text-ink">{s.apy != null ? `${s.apyEstimated ? "~" : ""}${s.apy}%` : "—"}</div>
                  {s.apyEstimated && <div className="text-[10px] text-faint">estimate</div>}
                </div>
                <div className="stat-tile">
                  <div className="text-[11px] font-medium text-muted">Risk score</div>
                  <div className="mt-1 font-display text-[18px] font-semibold text-green">{s.riskScore}</div>
                </div>
                <div className="stat-tile">
                  <div className="text-[11px] font-medium text-muted">Liquidity</div>
                  <div className="mt-1 text-[12px] font-semibold text-ink">{s.liquidity}</div>
                </div>
              </div>
              <div className="mt-4 grid gap-1.5 text-[12px] text-muted">
                <div className="flex justify-between">
                  <span>Asset</span>
                  <span className="font-semibold text-ink">{s.asset === IXS_USDC_SYMBOL ? "IXS test USDC (ixUSDC)" : s.asset}</span>
                </div>
                <div className="flex justify-between">
                  <span>Settlement</span>
                  <span className="font-semibold text-ink">{s.settlement === "sync" ? "Sync (ERC-4626)" : "Async (ERC-7540)"}</span>
                </div>
                {s.tvlUsd != null && (
                  <div className="flex justify-between">
                    <span>Vault TVL (on-chain)</span>
                    <span className="font-semibold text-ink">{fmtUsd(s.tvlUsd, { decimals: 2 })}</span>
                  </div>
                )}
                {s.sharePrice != null && (
                  <div className="flex justify-between">
                    <span>Price per share</span>
                    <span className="font-semibold text-ink">{s.sharePrice.toFixed(4)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Eligibility</span>
                  <span className={cx("font-semibold", s.requiresWhitelist ? "text-amber" : "text-green")}>{s.requiresWhitelist ? "Whitelist required" : "Open"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Your position</span>
                  <span className="font-semibold text-ink">{p ? fmtUsd(p.valueUsd) : "—"}</span>
                </div>
              </div>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
                <Pill tone={s.executable ? "green" : "muted"}>{s.executable ? (s.routeId ? "Executable · IXS MCP" : `Executable on ${CHAIN_NAME}`) : s.capacityNote ?? "Prepared via IXS rail"}</Pill>
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
          <div className="font-display text-[16px] font-semibold text-ink">Live from the IXS Vault API · {CHAIN_NAME}</div>
          <Pill tone={liveOk ? "green" : "amber"}>{liveOk ? "api-dev-v2.ixs.finance · connected" : "IXS API unreachable · cached"}</Pill>
        </div>
        <div className="mt-1 text-[13px] text-muted">Vaults IXS exposes to agents on {CHAIN_NAME}. Deposit and redeem transactions for these are built through IXS MCP (vault_build_request_deposit, vault_check_whitelist).</div>
        <div className="mt-4 overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="table-head" style={{ gridTemplateColumns: "1.6fr 1.2fr .8fr 1fr 1fr 1fr" }}>
              <span>Vault</span>
              <span>Vaulto strategy</span>
              <span>Asset</span>
              <span>Whitelist</span>
              <span>Status</span>
              <span>Contract</span>
            </div>
            {liveVaults.map((v) => (
              <div key={v.routeId} className="table-row text-ink" style={{ gridTemplateColumns: "1.6fr 1.2fr .8fr 1fr 1fr 1fr" }}>
                <div>
                  <div className="font-semibold">{v.name}</div>
                  <div className="mono text-[11px] font-normal text-faint">{v.routeId}</div>
                </div>
                <span className="text-[13px]">{strategies.find((s) => s.id === v.strategyId)?.vaultName ?? "—"}</span>
                <span>{v.asset}</span>
                <span className={v.requiresWhitelist ? "text-amber" : "text-green"}>{v.requiresWhitelist ? "Required" : "Open"}</span>
                <span className="capitalize">{v.status}</span>
                <a href={v.explorerUrl || "#"} target="_blank" rel="noreferrer" className="mono inline-flex items-center gap-1 text-blue-deep">
                  {v.contractAddress.slice(0, 8)}… {Icons.external}
                </a>
              </div>
            ))}
            {!liveVaults.length && <div className="py-6 text-center text-[13px] text-muted">No live vaults returned for {CHAIN_NAME}.</div>}
          </div>
        </div>
      </Card>
    </div>
  );
}
