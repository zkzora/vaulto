import { CHAIN_ID, CHAIN_KEY, CHAIN_NAME, MIN_DEPOSIT_USDC, STRATEGY_IDS } from "@/lib/chain/config";
import type { VaultStrategy } from "@/lib/types";
import type { IxsVaultItem, Registry, RegistryVault } from "./registry";

export type { IxsVaultItem } from "./registry";

/** IXS FAQ: redemptions can be requested anytime and settle after the current cycle, as fast as T+1. */
export const REDEMPTION_NOTE = "Request anytime · processed after the current redemption cycle (as fast as T+1, per IXS)";

function termsFor(v: RegistryVault): NonNullable<VaultStrategy["terms"]> {
  return {
    minDepositUsd: MIN_DEPOSIT_USDC,
    depositFeeBps: 0,
    redeemFeeBps: v.redeemFeeBps,
    redemption: REDEMPTION_NOTE,
    feeSource: v.redeemFeeBps != null ? "on-chain (feeBps)" : "not exposed by the contract",
  };
}

/**
 * Vaulto's strategy catalog on BNB Chain. Every executable entry is a live IXS production vault:
 *
 * - IX High Yield Bond (USDC), open vault: sync ERC-4626. Deposits are built by the IXS MCP and either
 *   simulated (eth_call + state override) or signed by the wallet in Live mode.
 * - IX High Yield Bond (USDC), licensed vault: ERC-7540 async, whitelist (KYC) required; eligibility is
 *   checked live through the IXS MCP before any allocation.
 * - BTC Real Yield: announced by IXS, no vault deployed; kept so the agent can reject idle BTC explicitly.
 */
export function buildCatalog(registry: Registry, live: IxsVaultItem[] = []): VaultStrategy[] {
  const open = registry.vaults.find((v) => !v.requiresWhitelist) ?? null;
  const licensed = registry.vaults.find((v) => v.requiresWhitelist) ?? null;
  const out: VaultStrategy[] = [];

  if (open) {
    out.push({
      id: STRATEGY_IDS.hybrid,
      provider: "IXS",
      vaultName: "IX High Yield Bond (USDC)",
      assetType: `IXS RWA vault · ERC-4626 · ${open.symbol}`,
      asset: open.asset.symbol,
      apy: open.ttm,
      apyEstimated: false,
      apyNote: open.ttm != null ? "trailing 12 months · IXS Vault API" : "IXS API reports no yield figure yet",
      riskScore: 92,
      liquidity: open.settlement === "sync" ? "Redeem anytime · cycle as fast as T+1" : "Request → claim (async)",
      chainId: CHAIN_ID,
      network: CHAIN_KEY,
      chainName: CHAIN_NAME,
      contractAddress: open.address,
      assetAddress: open.asset.address,
      assetDecimals: open.asset.decimals,
      shareDecimals: open.shareDecimals,
      shareSymbol: open.symbol,
      settlement: open.settlement,
      requiresWhitelist: false,
      status: open.paused ? "paused" : open.status,
      description:
        "The open IX High Yield Bond vault on BNB Chain: stablecoins put to work in U.S. Treasuries and high-yield corporate bonds through IXS. Vaulto reads asset(), decimals() and fees from the contract, builds deposits with the IXS MCP and simulates or signs them from your wallet.",
      source: "catalog",
      executable: true,
      tag: "primary",
      routeId: open.routeId,
      explorerUrl: open.explorerUrl,
      capacityNote: "Official IXS vault · calldata by IXS MCP",
      tvlUsd: open.totalAssets,
      sharePrice: open.sharePrice,
      terms: termsFor(open),
    });
  }

  if (licensed) {
    out.push({
      id: STRATEGY_IDS.licensed,
      provider: "IXS",
      vaultName: "IX High Yield Bond · Licensed (KYC)",
      assetType: `Permissioned RWA vault · ERC-7540 (async) · ${licensed.symbol}`,
      asset: licensed.asset.symbol,
      apy: licensed.ttm,
      apyEstimated: false,
      apyNote: licensed.ttm != null ? "trailing 12 months · IXS Vault API" : undefined,
      riskScore: 88,
      liquidity: "Request → claim (async)",
      chainId: CHAIN_ID,
      network: CHAIN_KEY,
      chainName: CHAIN_NAME,
      contractAddress: licensed.address,
      assetAddress: licensed.asset.address,
      assetDecimals: licensed.asset.decimals,
      shareDecimals: licensed.shareDecimals,
      shareSymbol: licensed.symbol,
      settlement: licensed.settlement,
      requiresWhitelist: true,
      status: licensed.paused ? "paused" : licensed.status,
      description:
        "The permissioned IX High Yield Bond vault (identity verification through IXS required). Same strategy, licensed on-chain structure, async ERC-7540 settlement. Eligibility is checked live through the IXS MCP before any allocation.",
      source: "catalog",
      executable: true,
      tag: "opportunity",
      routeId: licensed.routeId,
      explorerUrl: licensed.explorerUrl,
      capacityNote: "KYC whitelist required · async settlement",
      tvlUsd: licensed.totalAssets,
      sharePrice: licensed.sharePrice,
      terms: termsFor(licensed),
    });
  }

  const btcLive = live.some((v) => /BTC/i.test(v.underlyingAsset?.symbol ?? ""));
  out.push({
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
    status: btcLive ? "active" : "announced",
    description: "Announced on ixs.finance (BTC Real Yield, 4–12% indicative APY) but no BTC vault exists on the IXS Vault API. Vaulto checks availability on every analysis and will make it allocatable the moment IXS deploys it.",
    source: "catalog",
    executable: false,
    tag: "announced",
    availability: btcLive ? "live" : "announced",
    capacityNote: "Announced by IXS · not deployable yet",
  });

  return out;
}
