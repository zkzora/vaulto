"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useVaultoAccount } from "@/hooks/use-account";
import { useTreasury } from "@/hooks/use-vaulto";
import { useTxn } from "@/components/txn/txn-provider";
import { CHAIN_NAME, SUPPORTED_CHAIN_IDS, chainInfo, modeLabel } from "@/lib/chain/config";
import { shortAddress } from "@/lib/format";
import { Icons, Pill, VaultoLogo } from "@/components/ui";

export function Topbar() {
  const account = useVaultoAccount();
  const { data } = useTreasury();
  const txn = useTxn();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const seenEvent = useRef<string | null>(null);
  const daoName = data?.user.daoName ?? "Treasury";
  const initials = daoName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const openRec = data?.recommendation?.status === "proposed";
  const snapshot = data?.snapshot;
  const rpcKind = snapshot?.onchain.rpcKind ?? "mainnet";
  const liveChains = snapshot?.liveChainIds ?? [];
  const label = liveChains.length ? liveChains.map((c) => modeLabel("live", c)).join(" + ") : rpcKind === "fork" ? modeLabel("simulated", 56, "fork") : "Simulated on BNB + Avalanche mainnet";
  const waiting = data?.watch.waiting ?? [];
  const latestEvent = data?.watch.events[0];

  // NAV / deposit-limit watcher notification: toast once per new event.
  useEffect(() => {
    if (!latestEvent) return;
    if (seenEvent.current === null) {
      seenEvent.current = latestEvent.id;
      return;
    }
    if (seenEvent.current !== latestEvent.id) {
      seenEvent.current = latestEvent.id;
      txn.notify({ tone: latestEvent.kind === "limit" ? "success" : "info", title: latestEvent.kind === "limit" ? "IXS vault deposit limit changed" : "IXS vault NAV refreshed", body: latestEvent.message });
    }
  }, [latestEvent, txn]);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-white px-6">
      <Link href="/" aria-label="Vaulto home">
        <VaultoLogo height={22} />
      </Link>
      <div className="flex items-center gap-2.5">
        {(account.isDemo || data?.user.demoMode) && (
          <Link href="/app/settings" title="The Acme DAO treasury is simulated (fake BTC + USDC holdings) on top of the real on-chain balances. Vault addresses, calldata and simulations are real.">
            <Pill tone="amber">Simulated treasury</Pill>
          </Link>
        )}
        {data && (
          <Link
            href="/app/settings"
            title={
              liveChains.length
                ? `Wallet holds ≥ 100 USDC on ${liveChains.map((c) => chainInfo(c).name).join(", ")}: deposits there are real and signed by your wallet.`
                : rpcKind === "fork"
                  ? "RPC_URL points at a local Anvil fork of mainnet."
                  : "Deposits are simulated with eth_call + state override against the real IXS vaults. Hold ≥ 100 USDC on a vault's chain to go live there."
            }
          >
            <Pill tone={liveChains.length ? "green" : rpcKind === "fork" ? "blue" : "amber"}>{label}</Pill>
          </Link>
        )}
        {waiting.length > 0 && (
          <Link href="/app/vaults" title={waiting.map((w) => `${w.chainName} ${w.symbol}: limit 0, NAV ${w.navAgeHours != null ? `${(w.navAgeHours / 24).toFixed(1)} d old` : "unknown"}`).join(" · ")}>
            <Pill tone="muted">{waiting.length} vault{waiting.length > 1 ? "s" : ""} waiting NAV refresh</Pill>
          </Link>
        )}
        {account.isWallet && account.chainId != null && !SUPPORTED_CHAIN_IDS.includes(account.chainId) && <Pill tone="red">Wrong network</Pill>}
        <ConnectButton.Custom>
          {({ account: wa, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
            const connected = mounted && wa && chain;
            return (
              <button
                onClick={() => {
                  if (connected) {
                    if (chain?.unsupported) openChainModal();
                    else openAccountModal();
                  } else if (account.isDemo) setOpen((v) => !v);
                  else openConnectModal();
                }}
                className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-line px-3 text-[13px] font-semibold text-ink hover:bg-canvas"
              >
                <span className="h-5 w-5 rounded-full" style={{ background: "linear-gradient(135deg,#5B8DEF,#0B1A3B)" }} />
                {daoName} · {shortAddress(account.address, 4)}
              </button>
            );
          }}
        </ConnectButton.Custom>
        {open && account.isDemo && (
          <div className="absolute right-6 top-14 z-40 w-64 rounded-xl border border-line bg-white p-3 shadow-panel rise">
            <div className="text-[12px] text-muted">Using the simulated treasury address. Connect a wallet to scan a real treasury on {CHAIN_NAME} and Avalanche.</div>
            <ConnectButton.Custom>
              {({ openConnectModal }) => (
                <button
                  className="btn btn-primary mt-3 w-full"
                  onClick={() => {
                    setOpen(false);
                    openConnectModal();
                  }}
                >
                  Connect wallet
                </button>
              )}
            </ConnectButton.Custom>
            <button
              className="btn btn-ghost mt-1 w-full"
              onClick={() => {
                setOpen(false);
                account.signOut();
                router.push("/connect");
              }}
            >
              Leave demo
            </button>
          </div>
        )}
        <Link href="/app/risk" className="relative flex h-9 w-9 items-center justify-center rounded-[10px] border border-line hover:bg-canvas" aria-label="Alerts">
          {Icons.bell}
          {(openRec || waiting.length > 0) && <span className="absolute right-2 top-[7px] h-[7px] w-[7px] rounded-full border-[1.5px] border-white bg-red" />}
        </Link>
        <Link href="/app/settings" className="flex h-9 w-9 items-center justify-center rounded-full bg-line font-display text-[13px] font-semibold text-ink" aria-label="Settings">
          {initials || "V"}
        </Link>
      </div>
    </header>
  );
}
