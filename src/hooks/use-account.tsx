"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { DEMO_ADDRESS } from "@/lib/demo";

const KEY = "vaulto:demo-address";
const EVENT = "vaulto:demo-change";
/** Set when the user explicitly chose a wallet (connect page, "Use connected wallet"); cleared when they pick the demo. */
const WALLET_KEY = "vaulto:wallet-intent";

/** Tiny external store around localStorage so React can subscribe without effects. */
const demoStore = {
  get(): string | null {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(value: string | null) {
    try {
      if (value) localStorage.setItem(KEY, value);
      else localStorage.removeItem(KEY);
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(EVENT));
  },
  subscribe(cb: () => void) {
    window.addEventListener(EVENT, cb);
    window.addEventListener("storage", cb);
    return () => {
      window.removeEventListener(EVENT, cb);
      window.removeEventListener("storage", cb);
    };
  },
};

const walletIntentStore = {
  get(): string | null {
    try {
      return localStorage.getItem(WALLET_KEY);
    } catch {
      return null;
    }
  },
  set(on: boolean) {
    try {
      if (on) localStorage.setItem(WALLET_KEY, "1");
      else localStorage.removeItem(WALLET_KEY);
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(EVENT));
  },
};

const subscribeNoop = () => () => {};

interface VaultoAccount {
  address: string | null;
  isWallet: boolean;
  isDemo: boolean;
  ready: boolean;
  chainId?: number;
  connector?: string;
  enterDemo: () => void;
  leaveDemo: () => void;
  /** Explicit choice of the connected wallet as the treasury (leaves the simulated treasury). */
  chooseWallet: () => void;
  /** A browser wallet is connected (it may be unused while the simulated treasury is chosen). */
  walletConnected: boolean;
  walletAddress: string | null;
  /** The user chose the connected wallet explicitly at some point (kept across reloads). */
  walletChosen: boolean;
  signOut: () => void;
}

const Ctx = createContext<VaultoAccount | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const { address, chainId, connector, isConnected, status } = useAccount();
  const { disconnect } = useDisconnect();
  const demo = useSyncExternalStore(demoStore.subscribe, demoStore.get, () => null);
  const walletIntent = useSyncExternalStore(demoStore.subscribe, walletIntentStore.get, () => null);
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  // Wait for wagmi to finish reconnecting a wallet before deciding which treasury to show (or redirecting to /connect).
  const ready = mounted && status !== "reconnecting" && status !== "connecting";

  const enterDemo = useCallback(() => {
    walletIntentStore.set(false);
    demoStore.set(DEMO_ADDRESS);
  }, []);
  const leaveDemo = useCallback(() => demoStore.set(null), []);
  const chooseWallet = useCallback(() => {
    walletIntentStore.set(true);
    demoStore.set(null);
  }, []);
  const signOut = useCallback(() => {
    demoStore.set(null);
    walletIntentStore.set(false);
    if (isConnected) disconnect();
  }, [disconnect, isConnected]);

  // The simulated treasury wins over a wallet that merely (auto-)reconnected: the wallet is used only when there is no
  // demo choice, or when the user explicitly chose it (walletIntent).
  const wallet = address ? address.toLowerCase() : null;
  const demoChosen = Boolean(demo) && !(walletIntent && wallet);
  const value = useMemo<VaultoAccount>(
    () => ({
      address: demoChosen ? demo : wallet,
      isWallet: !demoChosen && Boolean(wallet),
      isDemo: demoChosen,
      ready,
      chainId,
      connector: connector?.name,
      enterDemo,
      leaveDemo,
      chooseWallet,
      walletConnected: Boolean(wallet),
      walletAddress: wallet,
      walletChosen: Boolean(walletIntent),
      signOut,
    }),
    [demoChosen, demo, wallet, walletIntent, ready, chainId, connector?.name, enterDemo, leaveDemo, chooseWallet, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVaultoAccount() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useVaultoAccount must be used within AccountProvider");
  return ctx;
}
