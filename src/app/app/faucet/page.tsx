"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FaucetCard, getFaucetStatus } from "@/components/dashboard/faucet-card";
import { useVaultoAccount } from "@/hooks/use-account";
import { useActivity, useTreasury } from "@/hooks/use-vaulto";
import { CHAIN_NAME, FAUCET_LINKS, IXS_USDC_SYMBOL, NATIVE_SYMBOL } from "@/lib/chain/config";
import { fmtTime, fmtShortDate, shortAddress } from "@/lib/format";
import { Card, CardTitle, ErrorState, Icons, IxsMark, Pill, Skeleton } from "@/components/ui";

const STEPS = [
  ["Claim", `The faucet wallet sends ${NATIVE_SYMBOL} for gas and, while it holds some, IXS test USDC (${IXS_USDC_SYMBOL}). Real transactions on ${CHAIN_NAME}.`],
  ["Scan", "The Treasury Scanner reads your ixUSDC balance and IXS vault shares from the chain in one Multicall."],
  ["Allocate", "Run an analysis, approve, and your wallet signs approve + deposit. The calldata comes from the IXS MCP (vault_build_request_deposit)."],
  ["Track", "Positions, TVL and price per share are read back from the IXS vault contracts. Every hash is in Activity."],
];

export default function FaucetPage() {
  const account = useVaultoAccount();
  const treasury = useTreasury();
  const activity = useActivity();
  const info = useQuery({ queryKey: ["faucet-info"], queryFn: () => getFaucetStatus() });

  if (treasury.isError) return <ErrorState message={treasury.error.message} retry={() => treasury.refetch()} />;
  if (!treasury.data) return <Skeleton className="h-96" />;
  const { snapshot } = treasury.data;
  const d = info.data;
  const claims = (activity.data?.logs ?? []).filter((l) => l.action === "faucet");

  return (
    <div className="grid content-start gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">Testnet Faucet</div>
          <div className="mt-1 text-[14px] text-muted">{CHAIN_NAME} gas and IXS test USDC for a fully on-chain Vaulto run against the real IXS vaults.</div>
        </div>
        {d && <Pill tone={d.configured ? (d.ixUsdcAvailable ? "green" : "amber") : "amber"} className="h-7 px-3 text-[13px]">{!d.configured ? "Not configured" : d.ixUsdcAvailable ? `Live · ${IXS_USDC_SYMBOL} available` : `Live · gas only`}</Pill>}
      </div>

      {account.isWallet ? (
        <FaucetCard onchain={snapshot.onchain} />
      ) : (
        <Card className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-display text-[18px] font-semibold text-ink">Connect a wallet to claim</div>
            <div className="mt-1 text-[14px] text-body">The demo treasury is simulated. Connect a browser wallet on {CHAIN_NAME} to receive gas and IXS test USDC and execute real deposits.</div>
          </div>
          <Link href="/connect" className="btn btn-primary">Connect wallet</Link>
        </Card>
      )}

      {d && !d.ixUsdcAvailable && (
        <div className="rounded-xl border border-amber-line bg-amber-tint px-4 py-3 text-[13px] leading-relaxed text-amber">
          <b>How to get {IXS_USDC_SYMBOL}.</b> The IXS test USDC ({shortAddress(d.ixs.usdc, 6)}) can only be minted by IXS (owner {shortAddress(d.ixs.usdcOwner, 6)}). Ask the IXS team to send test USDC on {CHAIN_NAME} to your wallet, or to the Vaulto faucet wallet {d.faucetAddress ? shortAddress(d.faucetAddress, 6) : ""} so the faucet can hand out {d.amounts.IXUSDC} {IXS_USDC_SYMBOL} per claim.
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardTitle>How it works</CardTitle>
          <div className="mt-4 grid gap-0">
            {STEPS.map(([t, b], i) => (
              <div key={t} className="flex gap-3.5 border-b border-canvas py-3.5 last:border-0">
                <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-tint font-display text-[12px] font-semibold text-blue-deep">{i + 1}</span>
                <div>
                  <div className="text-[14px] font-semibold text-ink">{t}</div>
                  <div className="mt-0.5 text-[13px] leading-[1.5] text-muted">{b}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl bg-canvas px-4 py-3 text-[12px] leading-relaxed text-muted">
            One claim per wallet every 24 hours: {d?.amounts.NATIVE ?? 0.0015} {NATIVE_SYMBOL} for gas plus {d?.amounts.IXUSDC ?? 100} {IXS_USDC_SYMBOL} while the faucet holds IXS test USDC. Nothing here has real value.
          </div>
        </Card>

        <Card>
          <CardTitle action={d?.faucetNativeBalance != null ? <span className="text-[12px] font-medium text-faint">Faucet {d.faucetNativeBalance.toFixed(4)} {NATIVE_SYMBOL} · {(d.faucetIxUsdcBalance ?? 0).toLocaleString("en-US")} {IXS_USDC_SYMBOL}</span> : undefined}>IXS contracts on {CHAIN_NAME}</CardTitle>
          <div className="mt-3 grid gap-2 text-[13px]">
            {d ? (
              <>
                <a href={`${d.explorer}/address/${d.ixs.vault}`} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded-xl border-[1.5px] border-blue bg-tint-2 px-3.5 py-2.5 hover:bg-tint">
                  <span className="inline-flex items-center gap-2">
                    <IxsMark size={18} />
                    <span>
                      <span className="font-semibold text-ink">IX High Yield Bond (IXHYB)</span> <span className="text-muted">· official IXS vault · ERC-4626</span>
                    </span>
                  </span>
                  <span className="mono inline-flex items-center gap-1 text-blue-deep">
                    {shortAddress(d.ixs.vault, 6)} {Icons.external}
                  </span>
                </a>
                <a href={`${d.explorer}/token/${d.ixs.usdc}`} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-2.5 hover:bg-canvas">
                  <span>
                    <span className="font-semibold text-ink">{d.ixs.usdcSymbol}</span> <span className="text-muted">· IXS test USDC · 6 decimals · minted by IXS</span>
                  </span>
                  <span className="mono inline-flex items-center gap-1 text-blue-deep">
                    {shortAddress(d.ixs.usdc, 6)} {Icons.external}
                  </span>
                </a>
                {d.faucetAddress && (
                  <a href={`${d.explorer}/address/${d.faucetAddress}`} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-2.5 hover:bg-canvas">
                    <span>
                      <span className="font-semibold text-ink">Vaulto faucet wallet</span> <span className="text-muted">· sends {NATIVE_SYMBOL} and forwards {IXS_USDC_SYMBOL}</span>
                    </span>
                    <span className="mono inline-flex items-center gap-1 text-blue-deep">
                      {shortAddress(d.faucetAddress, 6)} {Icons.external}
                    </span>
                  </a>
                )}
              </>
            ) : (
              <Skeleton className="h-32" />
            )}
          </div>
          <div className="mt-3 text-[12px] text-muted">
            Need {NATIVE_SYMBOL} yourself?{" "}
            {FAUCET_LINKS.map((f, i) => (
              <span key={f.url}>
                <a href={f.url} target="_blank" rel="noreferrer" className="font-semibold text-blue-deep">
                  {f.name}
                </a>
                {i < FAUCET_LINKS.length - 1 ? " · " : ""}
              </span>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle action={<span className="text-[12px] font-medium text-faint">{claims.length} claim{claims.length === 1 ? "" : "s"}</span>}>Claim history</CardTitle>
        <div className="mt-2 grid">
          {claims.map((l) => (
            <div key={l.id} className="flex items-start gap-3 border-b border-canvas py-2.5 text-[13px] last:border-0">
              <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full bg-green" />
              <div>
                <div className="font-medium text-ink">{l.reasoning}</div>
                <div className="text-[12px] text-faint">
                  {fmtShortDate(l.createdAt)} · {fmtTime(l.createdAt)}
                </div>
              </div>
            </div>
          ))}
          {!claims.length && <div className="py-4 text-[13px] text-muted">No claims yet for this wallet.</div>}
        </div>
      </Card>
    </div>
  );
}
