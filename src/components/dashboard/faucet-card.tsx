"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVaultoAccount } from "@/hooks/use-account";
import { CHAIN_NAME, IXS_USDC_SYMBOL, NATIVE_SYMBOL } from "@/lib/chain/config";
import { shortAddress } from "@/lib/format";
import type { OnchainReadout } from "@/lib/types";
import { Icons, Pill, cx } from "@/components/ui";

export interface FaucetStatus {
  configured: boolean;
  chainName: string;
  nativeSymbol: string;
  faucetAddress?: string;
  faucetNativeBalance?: number;
  faucetIxUsdcBalance?: number;
  ixUsdcAvailable: boolean;
  amounts: { NATIVE: number; IXUSDC: number };
  ixs: { vault: string; usdc: string; usdcSymbol: string; usdcOwner: string };
  explorer: string;
  faucetLow: boolean;
  nextClaimAt: string | null;
  /** Why a claim is blocked right now (null when it can proceed). */
  reason: string | null;
  canClaim: boolean;
}

interface FaucetTx {
  kind: "native" | "transfer";
  asset: string;
  amount: number;
  hash: string;
  explorerUrl: string;
}

export async function getFaucetStatus(address?: string | null): Promise<FaucetStatus> {
  const res = await fetch(address ? `/api/faucet?address=${address}` : "/api/faucet");
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "faucet status failed");
  return json;
}

async function claim(address: string): Promise<{ txs: FaucetTx[] }> {
  const res = await fetch("/api/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "faucet claim failed");
  return json;
}

export function FaucetCard({ onchain, compact }: { onchain: OnchainReadout; compact?: boolean }) {
  const account = useVaultoAccount();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["faucet", account.address], queryFn: () => getFaucetStatus(account.address), enabled: Boolean(account.address) && account.isWallet });
  const mutation = useMutation({
    mutationFn: () => claim(account.address!),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (!account.isWallet) return null;
  const s = status.data;
  const ix = onchain.balances[IXS_USDC_SYMBOL] ?? 0;
  const funded = ix > 0 || onchain.positions.length > 0;
  const hasGas = onchain.nativeBalance >= 0.0005;

  return (
    <div className={cx("card flex flex-col", compact ? "p-5" : "p-6")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">Testnet faucet · {CHAIN_NAME}</span>
          {s && <Pill tone={s.configured ? (s.ixUsdcAvailable ? "green" : "amber") : "amber"}>{!s.configured ? "Faucet key missing" : s.ixUsdcAvailable ? `Gas + ${IXS_USDC_SYMBOL} available` : `Gas only · no ${IXS_USDC_SYMBOL} in faucet`}</Pill>}
        </div>
        {s?.faucetAddress && (
          <a href={`${s.explorer}/address/${s.faucetAddress}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-blue-deep">
            Faucet {shortAddress(s.faucetAddress)} {Icons.external}
          </a>
        )}
      </div>
      <div className="mt-2 font-display text-[18px] font-semibold text-ink">{funded ? "Wallet holds IXS test USDC" : "Get test funds for the IXS vaults"}</div>
      <div className="mt-1.5 text-[13px] leading-relaxed text-body">
        {funded
          ? `Run an analysis: approved deposits are built by the IXS MCP, signed in your wallet and land in the IXS vault on ${CHAIN_NAME}.`
          : `The faucet sends ${s?.amounts.NATIVE ?? 0.0015} ${NATIVE_SYMBOL} for gas${s?.ixUsdcAvailable ? ` and ${s?.amounts.IXUSDC ?? 100} ${IXS_USDC_SYMBOL} (IXS test USDC) so you can deposit into the official IXS vault` : ""}. ${IXS_USDC_SYMBOL} is minted by IXS only: ${s?.ixUsdcAvailable ? "" : "the faucet has none right now, so ask the IXS team to send test USDC to your wallet or to the faucet wallet."}`}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[
          [NATIVE_SYMBOL, onchain.nativeBalance.toFixed(4)],
          [`${IXS_USDC_SYMBOL} (IXS test USDC)`, ix.toLocaleString("en-US", { maximumFractionDigits: 2 })],
          ["IXS vault positions", String(onchain.positions.length)],
        ].map(([l, v]) => (
          <div key={l} className="stat-tile">
            <div className="text-[11px] font-medium text-muted">{l}</div>
            <div className="mt-1 font-display text-[16px] font-semibold text-ink">{v}</div>
          </div>
        ))}
      </div>
      {mutation.data && (
        <div className="mt-3 grid gap-1.5 rounded-xl bg-green-tint px-3.5 py-3 text-[12px] text-green">
          {mutation.data.txs.map((t) => (
            <a key={t.hash} href={t.explorerUrl} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 font-medium">
              <span>
                Sent {t.amount} {t.asset}
              </span>
              <span className="mono inline-flex items-center gap-1">
                {shortAddress(t.hash, 6)} {Icons.external}
              </span>
            </a>
          ))}
        </div>
      )}
      {mutation.isError && <div className="mt-3 rounded-xl bg-amber-tint px-3.5 py-2.5 text-[12px] text-amber">{mutation.error.message}</div>}
      {!mutation.isError && s?.reason && !s.nextClaimAt && <div className="mt-3 rounded-xl bg-amber-tint px-3.5 py-2.5 text-[12px] text-amber">{s.reason}</div>}
      <div className="mt-auto flex flex-wrap items-center gap-2.5 pt-4">
        <button className="btn btn-primary" disabled={!s?.canClaim || mutation.isPending || (hasGas && !s?.ixUsdcAvailable)} onClick={() => mutation.mutate()}>
          {mutation.isPending && <span className="spinner" />}
          {mutation.isPending ? `Sending on ${CHAIN_NAME}…` : s?.nextClaimAt ? "Already claimed" : s?.faucetLow ? "Faucet needs gas" : hasGas && !s?.ixUsdcAvailable ? "Nothing to claim right now" : "Get test funds"}
        </button>
        {s?.nextClaimAt && <span className="text-[12px] text-muted">Claimed {new Date(s.nextClaimAt).toLocaleString()} · one claim per wallet</span>}
        {s?.faucetNativeBalance != null && (
          <span className="ml-auto text-[12px] text-faint">
            Faucet {s.faucetNativeBalance.toFixed(4)} {NATIVE_SYMBOL} · {(s.faucetIxUsdcBalance ?? 0).toLocaleString("en-US")} {IXS_USDC_SYMBOL}
          </span>
        )}
      </div>
    </div>
  );
}
