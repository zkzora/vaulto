import type { DemoState } from "./types";

/**
 * Demo treasury profile used in hybrid mode ("Acme DAO"). It lets judges see a realistic
 * treasury while the wallet on BSC Testnet may be nearly empty. On-chain balances are always
 * layered on top of this profile; simulated executions move demo capital via DemoState.
 * BTC is kept as an idle reserve asset: IXS has announced BTC Real Yield but no BTC vault is live yet.
 */
export const DEMO_ADDRESS = "0x7a3f5c1e9b2d4a6f8c0e1d3b5a7c9e2f4b6d9c21";

export interface DemoHolding {
  symbol: string;
  name: string;
  amount: number;
  deployedIn?: string; // strategy id
  idleDays: number;
  color: string;
}

export const DEMO_HOLDINGS: DemoHolding[] = [
  { symbol: "BTC", name: "Bitcoin · treasury reserve", amount: 12.4, idleDays: 23, color: "#F2A93B" },
  { symbol: "ixUSDC", name: "USDC · runway (IXS test USDC)", amount: 595_270, idleDays: 23, color: "#2775CA" },
  { symbol: "ixUSDC", name: "USDC · runway (IXS test USDC)", amount: 347_250, deployedIn: "ixs-hybrid-yield-bsc", idleDays: 0, color: "#2775CA" },
];

export const ASSET_META: Record<string, { name: string; color: string }> = {
  BTC: { name: "Bitcoin", color: "#F2A93B" },
  USDC: { name: "USD Coin", color: "#2775CA" },
  ixUSDC: { name: "IXS test USDC", color: "#2775CA" },
  ETH: { name: "Ether", color: "#627EEA" },
  tBNB: { name: "Test BNB · gas", color: "#F0B90B" },
  USTB: { name: "Tokenized T-bills", color: "#17996A" },
};

export const emptyDemoState = (): DemoState => ({ moves: [] });
