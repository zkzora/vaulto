"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useConnect } from "wagmi";
import { useVaultoAccount } from "@/hooks/use-account";
import { WALLETCONNECT_ENABLED } from "@/components/providers";
import { CHAIN_NAME } from "@/lib/chain/config";
import { Icons, VaultoLogo, cx } from "@/components/ui";

const STEPS = [
  ["Connect wallet", "Read-only until you approve an action."],
  ["Set risk preference", "Liquidity floor and max exposure."],
  ["Review first strategy", "OpenServ analyzes your treasury in about a minute."],
];

/** True when any EIP-1193 provider is injected in this browser. */
function detectProvider(): boolean {
  return typeof window !== "undefined" && Boolean((window as unknown as { ethereum?: unknown }).ethereum);
}

const noop = () => () => {};

export default function ConnectPage() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { connectors, connectAsync, isPending } = useConnect();
  const { openConnectModal } = useConnectModal();
  const account = useVaultoAccount();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const hasAnyProvider = useSyncExternalStore(noop, detectProvider, () => false);
  const ready = useSyncExternalStore(noop, () => true, () => false);

  useEffect(() => {
    if (isConnected) router.replace("/app");
  }, [isConnected, router]);

  // /connect?demo=1 → jump straight into the demo treasury (handy for judges and screenshots)
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "1") {
      account.enterDemo();
      router.replace("/app");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const injected = ready ? connectors.filter((c) => c.type === "injected") : [];
  // EIP-6963 discovered wallets (MetaMask, Rabby, Coinbase, OKX, …) have vendor ids; "injected" is the generic fallback.
  const discovered = injected.filter((c) => c.id !== "injected");
  const generic = injected.find((c) => c.id === "injected");
  const walletList = discovered.length ? discovered : hasAnyProvider && generic ? [generic] : [];
  const rank = (c: { id: string }) => (c.id === "io.metamask" ? 0 : c.id === "io.rabby" ? 1 : 2);
  walletList.sort((a, b) => rank(a) - rank(b));

  const connectWith = async (connector: (typeof connectors)[number]) => {
    setError(null);
    try {
      setBusy(connector.uid);
      await connectAsync({ connector });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Connection failed";
      setError(/rejected|denied/i.test(msg) ? `Connection rejected in ${connector.name}.` : msg.split("\n")[0].slice(0, 160));
    } finally {
      setBusy(null);
    }
  };

  const enterDemo = () => {
    account.enterDemo();
    router.push("/app");
  };

  const walletOptions = walletList.map((c, i) => ({
    key: c.uid,
    title: c.id === "injected" ? "Browser wallet" : c.name,
    sub: c.id === "injected" ? "Injected wallet detected in this browser" : `Detected in this browser · ${CHAIN_NAME}`,
    badge: i === 0 ? "Detected" : undefined,
    onClick: () => connectWith(c),
    icon: c.icon ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={c.icon} alt="" className="h-10 w-10 rounded-[10px]" />
    ) : (
      <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-ink font-display text-[14px] font-bold text-white">{(c.name[0] ?? "W").toUpperCase()}</span>
    ),
    primary: i === 0,
    disabled: false,
  }));

  const options = [
    ...walletOptions,
    ...(ready && !walletList.length
      ? [
          {
            key: "install",
            title: "No browser wallet detected",
            sub: "Install MetaMask or Rabby, then reload this page",
            badge: undefined,
            onClick: () => window.open("https://metamask.io/download/", "_blank", "noopener"),
            icon: <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#F6851B] font-display text-[14px] font-bold text-white">M</span>,
            primary: true,
            disabled: false,
          },
        ]
      : []),
    ...(WALLETCONNECT_ENABLED
      ? [
          {
            key: "walletconnect",
            title: "WalletConnect",
            sub: "Scan the QR with any mobile wallet",
            badge: undefined,
            onClick: () => openConnectModal?.(),
            icon: <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#3B99FC] font-display text-[14px] font-bold text-white">W</span>,
            primary: false,
            disabled: false,
          },
        ]
      : []),
    {
      key: "demo",
      title: "Continue with demo treasury",
      sub: "Acme DAO · explore Vaulto without a wallet (simulated)",
      badge: undefined,
      onClick: enterDemo,
      icon: <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-navy font-display text-[14px] font-bold text-white">A</span>,
      primary: false,
      disabled: false,
    },
  ];

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 pb-12 pt-24" style={{ background: "radial-gradient(800px 500px at 20% 10%, #EAF1FE, #F5F7FB 60%)" }}>
      <Link href="/" className="absolute left-6 top-7 lg:left-8">
        <VaultoLogo height={24} />
      </Link>
      <div className="grid w-full max-w-[860px] overflow-hidden rounded-[24px] border border-line bg-white shadow-panel md:grid-cols-[360px_1fr]">
        <div className="flex flex-col justify-between bg-navy p-9 text-white">
          <div>
            <div className="text-[13px] font-semibold uppercase tracking-[0.08em] text-sky">Get started</div>
            <div className="mt-3 font-display text-[28px] font-semibold leading-[1.2] tracking-[-0.02em]">Connect your treasury</div>
            <div className="mt-10 grid gap-[22px]">
              {STEPS.map(([t, b], i) => (
                <div key={t} className={cx("flex items-start gap-3.5", i > 0 && "opacity-55")}>
                  <span className={cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-[13px] font-semibold", i === 0 ? "bg-blue" : "border-[1.5px] border-white/40")}>{i + 1}</span>
                  <div>
                    <div className="text-[15px] font-semibold">{t}</div>
                    <div className="mt-0.5 text-[13px] leading-[1.5] text-cloud">{b}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-10 flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3.5">
            <span className="text-sky">{Icons.shield}</span>
            <span className="text-[13px] leading-[1.4] text-cloud">Vaulto never holds your funds or keys.</span>
          </div>
        </div>
        <div className="p-6 sm:p-9">
          <div className="flex items-center justify-between">
            <div className="font-display text-[22px] font-semibold tracking-[-0.01em] text-ink">Choose a wallet</div>
            <span className="pill bg-canvas text-muted">{CHAIN_NAME}</span>
          </div>
          <div className="mt-6 grid gap-2.5">
            {!ready && <div className="skeleton h-[74px]" />}
            {options.map((o) => (
              <button
                key={o.key}
                onClick={o.onClick}
                disabled={isPending || busy !== null || o.disabled}
                title={o.disabled ? o.sub : undefined}
                className={cx(
                  "flex items-center gap-3.5 rounded-[14px] p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55",
                  o.primary ? "border-[1.5px] border-blue bg-tint-2 hover:bg-tint" : "border border-line hover:bg-canvas",
                )}
              >
                {o.icon}
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold text-ink">{o.title}</div>
                  <div className="text-[13px] text-muted">{o.sub}</div>
                </div>
                {busy === o.key ? <span className="spinner spinner-blue" /> : o.badge ? <span className="pill h-6 bg-green-tint px-2.5 text-[12px] text-green">{o.badge}</span> : null}
              </button>
            ))}
          </div>
          {error && <div className="mt-4 rounded-xl bg-amber-tint px-4 py-3 text-[13px] leading-relaxed text-amber">{error}</div>}
          <div className="mt-6 border-t border-line-2 pt-5 text-[13px] leading-[1.55] text-muted">
            Connecting only lets Vaulto read balances on {CHAIN_NAME} and Avalanche. Deposits are simulated by default; in Live mode (opt-in) every transaction still needs your signature.
          </div>
        </div>
      </div>
    </div>
  );
}
