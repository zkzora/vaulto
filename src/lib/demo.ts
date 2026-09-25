import type { DemoState } from "./types";

/**
 * Demo treasury profile ("Acme DAO") for walkthroughs: a realistic treasury layered on top of whatever the
 * wallet really holds on BNB Chain. It is plainly labelled as simulated in the UI; vault addresses, asset
 * decimals, fees and calldata are always the real IXS ones. Simulated executions move demo capital via DemoState.
 * BTC is kept as an idle reserve asset: IXS has announced BTC Real Yield but no BTC vault is live.
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
  // No seeded vault position: the real ixv1 vault holds only a few hundred USDC, so a pre-existing simulated position
  // would contradict its on-chain totalAssets. Positions appear only after a simulated execution, labelled simulated.
  { symbol: "USDC", name: "USDC · runway", amount: 942_520, idleDays: 23, color: "#2775CA" },
];

export const ASSET_META: Record<string, { name: string; color: string }> = {
  BTC: { name: "Bitcoin", color: "#F2A93B" },
  USDC: { name: "USD Coin", color: "#2775CA" },
  ETH: { name: "Ether", color: "#627EEA" },
  BNB: { name: "BNB · gas", color: "#F0B90B" },
};

export const emptyDemoState = (): DemoState => ({ moves: [] });
