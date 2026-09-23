import { bscTestnet } from "viem/chains";

/**
 * Single-chain configuration: Vaulto runs on BSC Testnet, the IXS Finance test network where the
 * IXS Vault API + MCP expose live vaults (IXS Agent Rail launched on BNB Chain).
 * This file is client-safe (no server secrets).
 */
export const CHAIN = bscTestnet;
export const CHAIN_ID = bscTestnet.id; // 97
export const CHAIN_KEY = "bsc-testnet";
export const CHAIN_NAME = "BSC Testnet";
export const NATIVE_SYMBOL = "tBNB";
/** Price key used for the native token (CoinGecko id binancecoin). */
export const NATIVE_PRICE_KEY = "BNB";
export const EXPLORER = "https://testnet.bscscan.com";
export const DEFAULT_RPC = "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
export const PUBLIC_RPC = process.env.NEXT_PUBLIC_RPC_URL || DEFAULT_RPC;

export const FAUCET_LINKS = [
  { name: "BNB Chain testnet faucet", url: "https://www.bnbchain.org/en/testnet-faucet" },
  { name: "QuickNode BSC faucet", url: "https://faucet.quicknode.com/binance-smart-chain/bnb-testnet" },
];

/** Canonical symbol for the IXS test USDC, the only deposit asset of the IXS vaults on BSC Testnet. */
export const IXS_USDC_SYMBOL = "ixUSDC";

/** IXS Finance contracts on BSC Testnet (from the IXS Vault API, verified on-chain). */
export const IXS_BSC = {
  /** IXHYB - BSC: sync ERC-4626 vault, open whitelist, deposits built by IXS MCP. */
  hybridVault: "0xCb09a5326AEFD705d14FF4C5ca2beD7086ba0Dcc" as `0x${string}`,
  hybridRouteId: "97-0xcb09a5326aefd705d14ff4c5ca2bed7086ba0dcc",
  /** t_ix7540v1: async ERC-7540 vault, whitelist required (licensed / eligibility-gated). */
  licensedVault: "0x45B962394995e3FbFa83229Fbe97591dEb1DDCc4" as `0x${string}`,
  licensedRouteId: "97-0x45b962394995e3fbfa83229fbe97591deb1ddcc4",
  /** IXS test USDC (6 decimals). Owner-only mint: obtained from the IXS team, not a public faucet. */
  usdc: "0xbBCa80a7116aE46B0f249D279EF43f86274dc4f4" as `0x${string}`,
  usdcDecimals: 6,
};

export const STRATEGY_IDS = {
  hybrid: "ixs-hybrid-yield-bsc",
  licensed: "ixs-licensed-rwa",
} as const;
