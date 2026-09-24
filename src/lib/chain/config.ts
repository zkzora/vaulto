import { bsc } from "viem/chains";

/**
 * Single-chain configuration: Vaulto targets the IXS Finance production vaults on BNB Chain (chain 56).
 * Execution always runs against the real IXS contracts, in one of three modes:
 *  - "simulated": eth_call + state override (label "Simulated on BNB mainnet") while the wallet holds < 100 USDC
 *  - "live":      real deposits signed by the wallet, switched on automatically at >= 100 USDC
 *  - fork:        the same flows against a local Anvil fork of BNB mainnet (label "Mainnet fork", scripts/fork-demo.mjs)
 * This file is client-safe (no server secrets).
 */
export const CHAIN = bsc;
export const CHAIN_ID = bsc.id; // 56
export const CHAIN_KEY = "bsc";
export const CHAIN_NAME = "BNB Chain";
export const NATIVE_SYMBOL = "BNB";
/** Price key used for the native token (CoinGecko id binancecoin). */
export const NATIVE_PRICE_KEY = "BNB";
export const EXPLORER = "https://bscscan.com";
/** Public BNB Chain RPC that honours eth_call state overrides (verified for USDC balance + allowance overrides). */
export const DEFAULT_RPC = "https://bsc-dataseed.bnbchain.org";
export const PUBLIC_RPC = process.env.NEXT_PUBLIC_RPC_URL || DEFAULT_RPC;

/** Product id of the IX High Yield Bond vaults on the IXS Vault API. */
export const IXS_PRODUCT_ID = "ixhyb";

/**
 * Last-known IX High Yield Bond vault addresses on BNB Chain, as listed by GET https://api-v2.ixs.finance/vaults.
 * Used only as a skeleton when the IXS API is unreachable: asset(), decimals(), fees, pause and whitelist state are
 * always read from the contracts (see src/lib/ixs/registry.ts).
 */
export const IXS_KNOWN_VAULTS = [
  { routeId: "56-0xc975a3eef2e49f8eddef585340c43f15300fcb82", address: "0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82" as `0x${string}`, symbol: "ixv1", requiresWhitelist: false },
  { routeId: "56-0xd84129f506d1030dd6b46fe4a600d1e1c3b0802e", address: "0xD84129f506d1030Dd6b46Fe4A600d1E1c3b0802E" as `0x${string}`, symbol: "ix7540v1", requiresWhitelist: true },
];

export const STRATEGY_IDS = {
  /** Open IX High Yield Bond vault (sync ERC-4626). */
  hybrid: "ixhyb-bnb",
  /** Whitelist-gated IX High Yield Bond vault (async ERC-7540, KYC through IXS). */
  licensed: "ixhyb-bnb-licensed",
  /** Announced by IXS (ixs.finance/vaults), no vault deployed: kept in the catalog as not deployable. */
  btc: "ixs-btc-real-yield",
} as const;

/** Minimum deposit the agent enforces for the IXS vaults (USDC). */
export const MIN_DEPOSIT_USDC = 100;
/** Live mode (real, wallet-signed deposits) switches on automatically at this USDC balance. */
export const LIVE_MODE_MIN_USDC = 100;

export type ExecutionMode = "simulated" | "live";
export type RpcKind = "mainnet" | "fork";

/** A local RPC (Anvil) is treated as a mainnet fork; everything else as BNB mainnet itself. */
export function rpcKindOf(url: string): RpcKind {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/.test(url) ? "fork" : "mainnet";
}

export const MODE_LABEL: Record<ExecutionMode | RpcKind, string> = {
  simulated: "Simulated on BNB mainnet",
  live: "Live · BNB Chain",
  mainnet: "BNB mainnet",
  fork: "Mainnet fork",
};
