import { CHAIN_ID, CHAIN_KEY, CHAIN_NAME, EXPLORER, IXS_BSC, IXS_USDC_SYMBOL, STRATEGY_IDS } from "@/lib/chain/config";
import type { VaultStrategy } from "@/lib/types";

/** Shape of an item from GET https://api-dev-v2.ixs.finance/vaults. */
export interface IxsVaultItem {
  id: string;
  routeId: string;
  name: string;
  symbol: string;
  chainId: number;
  network: string;
  chainName: string;
  contractAddress: string;
  explorerUrl?: string;
  underlyingAsset?: { symbol: string; decimals: number; address: string };
  requiresWhitelist: boolean;
  status: string;
  metrics?: { apy?: number; tvl?: number } | null;
  ixsRewards?: { active: boolean; multiplier: number } | null;
}

/**
 * IXS strategy catalog on BSC Testnet. Every entry is a real IXS vault:
 *
 * - IX High Yield Bond (IXHYB · BSC): the official IXS vault. Sync ERC-4626, open whitelist. Deposits
 *   are built by the IXS MCP (`vault_build_request_deposit`) and signed by the user's wallet.
 * - Licensed RWA Vault Opportunities: the IXS whitelist-gated ERC-7540 vault; eligibility is checked
 *   live through the IXS MCP.
 *
 * Both take IXS test USDC (ixUSDC), which only IXS can mint.
 */
export function buildCatalog(live: IxsVaultItem[] = []): VaultStrategy[] {
  const explorer = (addr: string) => `${EXPLORER}/address/${addr}`;
  const hybridLive = live.find((v) => v.routeId === IXS_BSC.hybridRouteId);
  const licensedLive = live.find((v) => v.routeId === IXS_BSC.licensedRouteId);

  const hybrid: VaultStrategy = {
    id: STRATEGY_IDS.hybrid,
    provider: "IXS",
    vaultName: "IX High Yield Bond (IXHYB)",
    assetType: "IXS RWA vault · ERC-4626",
    asset: IXS_USDC_SYMBOL,
    apy: hybridLive?.metrics?.apy ?? 4.5,
    apyEstimated: hybridLive?.metrics?.apy == null,
    riskScore: 92,
    liquidity: "Daily (sync settlement)",
    chainId: CHAIN_ID,
    network: CHAIN_KEY,
    chainName: CHAIN_NAME,
    contractAddress: IXS_BSC.hybridVault,
    assetAddress: IXS_BSC.usdc,
    assetDecimals: IXS_BSC.usdcDecimals,
    settlement: "sync",
    requiresWhitelist: hybridLive?.requiresWhitelist ?? false,
    status: hybridLive?.status ?? "active",
    description:
      "The official IXS vault on BSC Testnet (high-yield bond exposure). Vaulto reads it through the IXS Vault API and builds deposits with the IXS MCP. Takes IXS test USDC (ixUSDC).",
    source: "catalog",
    executable: true,
    tag: "primary",
    routeId: IXS_BSC.hybridRouteId,
    explorerUrl: hybridLive?.explorerUrl ?? explorer(IXS_BSC.hybridVault),
    capacityNote: "Official IXS vault · calldata by IXS MCP",
  };

  const licensed: VaultStrategy = {
    id: STRATEGY_IDS.licensed,
    provider: "IXS",
    vaultName: "Licensed RWA Vault Opportunities",
    assetType: "Regulated RWA · ERC-7540 (async)",
    asset: IXS_USDC_SYMBOL,
    apy: licensedLive?.metrics?.apy ?? 6.2,
    apyEstimated: licensedLive?.metrics?.apy == null,
    riskScore: 88,
    liquidity: "Request → claim (async)",
    chainId: CHAIN_ID,
    network: CHAIN_KEY,
    chainName: CHAIN_NAME,
    contractAddress: IXS_BSC.licensedVault,
    assetAddress: IXS_BSC.usdc,
    assetDecimals: IXS_BSC.usdcDecimals,
    settlement: "async-erc7540",
    requiresWhitelist: true,
    status: licensedLive?.status ?? "active",
    description: "IXS whitelist-gated vault (t_ix7540v1). Regulated, capacity-limited; eligibility is checked live through the IXS MCP before any allocation.",
    source: "catalog",
    executable: false,
    tag: "opportunity",
    routeId: IXS_BSC.licensedRouteId,
    explorerUrl: licensedLive?.explorerUrl ?? explorer(IXS_BSC.licensedVault),
    capacityNote: "Eligibility check required · async settlement",
  };

  const btc: VaultStrategy = {
    id: STRATEGY_IDS.btc,
    provider: "IXS",
    vaultName: "BTC Real Yield",
    assetType: "Bitcoin-denominated real yield · 4–12% indicative (IXS)",
    asset: "BTC",
    apy: null,
    riskScore: 90,
    liquidity: "—",
    chainId: CHAIN_ID,
    network: CHAIN_KEY,
    chainName: CHAIN_NAME,
    settlement: "sync",
    requiresWhitelist: false,
    status: live.some((v) => /BTC/i.test(v.underlyingAsset?.symbol ?? "")) ? "active" : "announced",
    description: "Announced on ixs.finance (BTC Real Yield, 4–12% indicative APY) but no BTC vault exists on the IXS Vault API yet. Vaulto checks availability on every analysis and will make it allocatable the moment IXS deploys it.",
    source: "catalog",
    executable: false,
    tag: "announced",
    availability: live.some((v) => /BTC/i.test(v.underlyingAsset?.symbol ?? "")) ? "live" : "announced",
    capacityNote: "Announced by IXS · not deployable yet",
  };

  return [hybrid, licensed, btc];
}
