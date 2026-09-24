import { avalanche, bsc, type Chain } from "viem/chains";

/**
 * Chains Vaulto routes to: the IXS IX High Yield Bond vaults live on BNB Chain and Avalanche mainnet.
 * Execution always runs against the real IXS contracts, in one of three modes:
 *  - "simulated": eth_call + state override ("Simulated on <chain> mainnet") while the wallet holds < 100 USDC
 *  - "live":      real deposits signed by the wallet, switched on automatically at >= 100 USDC on that chain
 *  - fork:        the same flows against a local Anvil fork ("Mainnet fork", scripts/fork-demo.mjs)
 * This file is client-safe (no server secrets).
 */
export interface ChainInfo {
  id: number;
  chain: Chain;
  key: string;
  name: string;
  /** Short name used in mode labels ("Simulated on BNB mainnet"). */
  short: string;
  nativeSymbol: string;
  /** CoinGecko-style price key for the native token. */
  nativePriceKey: string;
  explorer: string;
  /** Public RPC that honours eth_call state overrides (verified for the USDC balance + allowance overrides). */
  defaultRpc: string;
  /** Multicall3 is deployed at the canonical address on both chains. */
  multicall: `0x${string}`;
}

export const CHAINS: Record<number, ChainInfo> = {
  56: { id: 56, chain: bsc, key: "bsc", name: "BNB Chain", short: "BNB", nativeSymbol: "BNB", nativePriceKey: "BNB", explorer: "https://bscscan.com", defaultRpc: "https://bsc-dataseed.bnbchain.org", multicall: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  43114: { id: 43114, chain: avalanche, key: "avalanche", name: "Avalanche C-Chain", short: "Avalanche", nativeSymbol: "AVAX", nativePriceKey: "AVAX", explorer: "https://snowscan.xyz", defaultRpc: "https://api.avax.network/ext/bc/C/rpc", multicall: "0xcA11bde05977b3631167028862bE2a173976CA11" },
};
export const SUPPORTED_CHAIN_IDS = Object.keys(CHAINS).map(Number);
export const chainInfo = (chainId: number): ChainInfo => CHAINS[chainId] ?? CHAINS[56];

/** Home chain: where the wallet connects by default and whose gas token the treasury shows first. */
export const CHAIN = bsc;
export const CHAIN_ID = bsc.id; // 56
export const CHAIN_KEY = "bsc";
export const CHAIN_NAME = "BNB Chain";
export const NATIVE_SYMBOL = "BNB";
export const NATIVE_PRICE_KEY = "BNB";
export const EXPLORER = "https://bscscan.com";
export const DEFAULT_RPC = CHAINS[56].defaultRpc;
export const PUBLIC_RPC = process.env.NEXT_PUBLIC_RPC_URL || DEFAULT_RPC;
export const PUBLIC_AVAX_RPC = process.env.NEXT_PUBLIC_AVAX_RPC_URL || CHAINS[43114].defaultRpc;

/** Product id of the IX High Yield Bond vaults on the IXS Vault API. */
export const IXS_PRODUCT_ID = "ixhyb";

/**
 * Last-known IX High Yield Bond vault addresses, as listed by GET https://api-v2.ixs.finance/vaults.
 * Used only as a skeleton when the IXS API is unreachable: asset(), decimals(), fees, pause, limits and whitelist
 * state are always read from the contracts and the IXS subgraphs (see src/lib/ixs/registry.ts).
 */
export const IXS_KNOWN_VAULTS = [
  { chainId: 56, routeId: "56-0xc975a3eef2e49f8eddef585340c43f15300fcb82", address: "0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82" as `0x${string}`, symbol: "ixv1", requiresWhitelist: false },
  { chainId: 56, routeId: "56-0xd84129f506d1030dd6b46fe4a600d1e1c3b0802e", address: "0xD84129f506d1030Dd6b46Fe4A600d1E1c3b0802E" as `0x${string}`, symbol: "ix7540v1", requiresWhitelist: true },
  { chainId: 43114, routeId: "43114-0xad01573b459805e3954398796203d830b57a8bd9", address: "0xaD01573b459805E3954398796203d830B57A8bD9" as `0x${string}`, symbol: "IXHYB", requiresWhitelist: false },
  { chainId: 43114, routeId: "43114-0x864e9c192a724773c2bb8c1e84572996074f0b41", address: "0x864E9C192a724773C2bB8C1e84572996074F0B41" as `0x${string}`, symbol: "IXHYB", requiresWhitelist: true },
];

/** Strategy ids: one per IXS vault (open / licensed × chain) plus the announced BTC product. */
export const STRATEGY_IDS = {
  hybrid: "ixhyb-bnb",
  licensed: "ixhyb-bnb-licensed",
  hybridAvax: "ixhyb-avax",
  licensedAvax: "ixhyb-avax-licensed",
  /** Announced by IXS (ixs.finance/vaults), no vault deployed: kept in the catalog as not deployable. */
  btc: "ixs-btc-real-yield",
} as const;

export function strategyIdFor(chainId: number, requiresWhitelist: boolean): string {
  if (chainId === 43114) return requiresWhitelist ? STRATEGY_IDS.licensedAvax : STRATEGY_IDS.hybridAvax;
  return requiresWhitelist ? STRATEGY_IDS.licensed : STRATEGY_IDS.hybrid;
}

/** Minimum deposit the agent enforces for the IXS vaults (USDC); the vaults enforce the same on-chain. */
export const MIN_DEPOSIT_USDC = 100;
/** Live mode (real, wallet-signed deposits) switches on automatically at this USDC balance on the vault's chain. */
export const LIVE_MODE_MIN_USDC = 100;
/** Vaulto policy: a NAV older than this is treated as stale (IXS publishes no staleness threshold on-chain). */
export const NAV_STALE_HOURS_DEFAULT = 72;
/** Hard cap per Live transaction (USDC) unless MAX_LIVE_TX_USDC overrides it. */
export const MAX_LIVE_TX_USDC_DEFAULT = 25_000;

export type ExecutionMode = "simulated" | "live";
export type RpcKind = "mainnet" | "fork";

/** A local RPC (Anvil) is treated as a mainnet fork; everything else as the chain itself. */
export function rpcKindOf(url: string): RpcKind {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/.test(url) ? "fork" : "mainnet";
}

export const MODE_LABEL = {
  simulated: "Simulated on BNB mainnet",
  live: "Live · BNB Chain",
  mainnet: "BNB mainnet",
  fork: "Mainnet fork",
} as const;

/** Honest execution label for a chain: "Simulated on Avalanche mainnet", "Live · BNB Chain", "Mainnet fork (BNB)". */
export function modeLabel(mode: ExecutionMode, chainId: number, rpcKind: RpcKind = "mainnet"): string {
  const c = chainInfo(chainId);
  if (rpcKind === "fork") return `Mainnet fork (${c.short})`;
  return mode === "live" ? `Live · ${c.name}` : `Simulated on ${c.short} mainnet`;
}
