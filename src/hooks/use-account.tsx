"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { DEMO_ADDRESS } from "@/lib/demo";

const KEY = "vaulto:demo-address";
const EVENT = "vaulto:demo-change";

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
  signOut: () => void;
}

const Ctx = createContext<VaultoAccount | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const { address, chainId, connector, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const demo = useSyncExternalStore(demoStore.subscribe, demoStore.get, () => null);
  const ready = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  const enterDemo = useCallback(() => demoStore.set(DEMO_ADDRESS), []);
  const leaveDemo = useCallback(() => demoStore.set(null), []);
  const signOut = useCallback(() => {
    demoStore.set(null);
    if (isConnected) disconnect();
  }, [disconnect, isConnected]);

  const value = useMemo<VaultoAccount>(
    () => ({
      address: address ? address.toLowerCase() : demo,
      isWallet: Boolean(address),
      isDemo: !address && Boolean(demo),
      ready,
      chainId,
      connector: connector?.name,
      enterDemo,
      leaveDemo,
      signOut,
    }),
    [address, demo, ready, chainId, connector?.name, enterDemo, leaveDemo, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVaultoAccount() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useVaultoAccount must be used within AccountProvider");
  return ctx;
}
