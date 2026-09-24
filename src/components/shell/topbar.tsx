"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useVaultoAccount } from "@/hooks/use-account";
import { useTreasury } from "@/hooks/use-vaulto";
import { CHAIN_ID, CHAIN_NAME, MODE_LABEL } from "@/lib/chain/config";
import { shortAddress } from "@/lib/format";
import { Icons, Pill, VaultoLogo } from "@/components/ui";

export function Topbar() {
  const account = useVaultoAccount();
  const { data } = useTreasury();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const daoName = data?.user.daoName ?? "Treasury";
  const initials = daoName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const openRec = data?.recommendation?.status === "proposed";
  const mode = data?.snapshot.executionMode;
  const rpcKind = data?.snapshot.onchain.rpcKind;
  const modeLabel = mode === "live" ? MODE_LABEL.live : rpcKind === "fork" ? MODE_LABEL.fork : MODE_LABEL.simulated;

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-white px-6">
      <Link href="/" aria-label="Vaulto home">
        <VaultoLogo height={22} />
      </Link>
      <div className="flex items-center gap-2.5">
        {account.isDemo && <Pill tone="amber">Demo treasury</Pill>}
        {data && (
          <Link
            href="/app/settings"
            title={
              mode === "live"
                ? `Wallet holds ≥ 100 USDC: deposits are real and signed by your wallet on ${CHAIN_NAME}.`
                : rpcKind === "fork"
                  ? "RPC_URL points at a local Anvil fork of BNB mainnet."
                  : "Deposits are simulated with eth_call + state override against the real IXS vault on BNB mainnet. Hold ≥ 100 USDC to go live."
            }
          >
            <Pill tone={mode === "live" ? "green" : rpcKind === "fork" ? "blue" : "amber"}>{modeLabel}</Pill>
          </Link>
        )}
        {account.isWallet && data?.user.demoMode && (
          <Link href="/app/settings" title="The simulated Acme DAO treasury is layered on top of your real balances. Turn it off in Settings.">
            <Pill tone="amber">Demo layer on · simulated $2.8M</Pill>
          </Link>
        )}
        {account.isWallet && account.chainId !== CHAIN_ID && <Pill tone="red">Wrong network</Pill>}
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
            <div className="text-[12px] text-muted">Using the demo treasury address. Connect a wallet to scan a real treasury on {CHAIN_NAME}.</div>
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
          {openRec && <span className="absolute right-2 top-[7px] h-[7px] w-[7px] rounded-full border-[1.5px] border-white bg-red" />}
        </Link>
        <Link href="/app/settings" className="flex h-9 w-9 items-center justify-center rounded-full bg-line font-display text-[13px] font-semibold text-ink" aria-label="Settings">
          {initials || "V"}
        </Link>
      </div>
    </header>
  );
}
