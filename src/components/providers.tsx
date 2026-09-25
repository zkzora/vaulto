"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, getDefaultConfig, lightTheme } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { WagmiProvider, http } from "wagmi";
import { CHAIN, CHAINS, PUBLIC_AVAX_RPC, PUBLIC_RPC } from "@/lib/chain/config";
import { AccountProvider } from "@/hooks/use-account";
import { TxnProvider } from "@/components/txn/txn-provider";

/** WalletConnect (QR, Safe, Ledger, mobile wallets) only works with a real Reown project id. */
export const WALLETCONNECT_ENABLED = Boolean(process.env.NEXT_PUBLIC_WC_PROJECT_ID);
const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID || "00000000000000000000000000000000";

export const wagmiConfig = getDefaultConfig({
  appName: "Vaulto",
  appDescription: "AI treasury allocation agent",
  projectId,
  chains: [CHAIN, CHAINS[43114].chain],
  transports: {
    [CHAIN.id]: http(PUBLIC_RPC),
    [CHAINS[43114].id]: http(PUBLIC_AVAX_RPC),
  },
  wallets: WALLETCONNECT_ENABLED
    ? [
        { groupName: "Recommended", wallets: [metaMaskWallet, injectedWallet] },
        { groupName: "Other", wallets: [walletConnectWallet] },
      ]
    : [{ groupName: "Recommended", wallets: [injectedWallet] }],
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 } } }),
  );
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={CHAIN}
          theme={lightTheme({ accentColor: "#5B8DEF", accentColorForeground: "#fff", borderRadius: "large", fontStack: "system" })}
          appInfo={{ appName: "Vaulto", learnMoreUrl: "/#security" }}
        >
          <AccountProvider>
            <TxnProvider>{children}</TxnProvider>
          </AccountProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
