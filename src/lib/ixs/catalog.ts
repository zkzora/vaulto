import { MIN_DEPOSIT_USDC, STRATEGY_IDS, chainInfo, strategyIdFor } from "@/lib/chain/config";
import type { VaultStrategy } from "@/lib/types";
import type { IxsVaultItem, Registry, RegistryVault } from "./registry";

export type { IxsVaultItem } from "./registry";

/** IXS FAQ: redemptions can be requested anytime and settle after the current cycle, as fast as T+1. */
export const REDEMPTION_NOTE = "Request anytime · processed after the current redemption cycle (as fast as T+1, per IXS) · operator pays USDC to the receiver, no claim step";

function termsFor(v: RegistryVault): NonNullable<VaultStrategy["terms"]> {
  return {
    minDepositUsd: v.minDeposit.usd || MIN_DEPOSIT_USDC,
    depositFeeBps: 0,
    redeemFeeBps: v.redeemFeeBps,
    redemption: REDEMPTION_NOTE,
    feeSource: v.redeemFeeBps != null ? "on-chain (feeBps)" : "not exposed by the contract",
  };
}

function fromVault(v: RegistryVault): VaultStrategy {
  const chain = chainInfo(v.chainId);
  const licensed = v.requiresWhitelist;
  const settlementText = v.settlement === "sync" ? "sync ERC-4626 (shares minted in the deposit tx)" : "async ERC-7540 (request → operator settles after the daily cycle)";
  return {
    id: strategyIdFor(v.chainId, licensed),
    provider: "IXS",
    vaultName: `IX High Yield Bond (USDC) · ${chain.short}${licensed ? " · Licensed" : ""}`,
    assetType: `${licensed ? "Permissioned" : "Open"} IXS RWA vault · ${v.settlement === "sync" ? "ERC-4626" : "ERC-7540"} · ${v.symbol}`,
    asset: v.asset.symbol,
    apy: v.ttm,
    apyEstimated: false,
    apyNote: v.ttm != null ? "trailing 12 months · IXS Vault API" : "IXS API reports no yield figure yet",
    riskScore: licensed ? 88 : 92,
    liquidity: v.settlement === "sync" ? "Redeem anytime · queued for the operator" : "Request → operator settles (async)",
    chainId: v.chainId,
    network: chain.key,
    chainName: chain.name,
    contractAddress: v.address,
    assetAddress: v.asset.address,
    assetDecimals: v.asset.decimals,
    shareDecimals: v.shareDecimals,
    shareSymbol: v.symbol,
    settlement: v.settlement,
    requiresWhitelist: licensed,
    status: v.paused ? "paused" : v.status,
    description: `${licensed ? "The permissioned" : "The open"} IX High Yield Bond vault on ${chain.name}: stablecoins put to work in U.S. Treasuries and high-yield corporate bonds through IXS. ${settlementText}. ${licensed ? "Identity verification (KYC) through IXS is required; eligibility is checked live through the IXS MCP." : "No whitelist."} Vaulto reads asset(), decimals(), fees and limits from the contract and builds deposits with the IXS MCP.`,
    source: "catalog",
    executable: true,
    tag: v.chainId === 56 && !licensed ? "primary" : licensed ? "opportunity" : "secondary",
    routeId: v.routeId,
    apiId: v.apiId,
    subgraphUrl: v.subgraphUrl,
    explorerUrl: v.explorerUrl,
    capacityNote: licensed ? "KYC whitelist required" : "Official IXS vault · calldata by IXS MCP",
    tvlUsd: v.totalAssets,
    sharePrice: v.sharePrice,
    terms: termsFor(v),
    depositLimitUsd: v.depositLimit.unlimited ? null : v.depositLimit.usd,
    depositLimitSource: v.depositLimit.source,
    nav: {
      pricePerShare: v.nav.pricePerShare,
      updatedAt: v.nav.updatedAt ? new Date(v.nav.updatedAt * 1000).toISOString() : null,
      ageHours: v.nav.ageHours,
      block: v.nav.block,
      lastChangeTx: v.nav.lastChangeTx,
      source: `${v.nav.source}${v.nav.lastChangeVerified ? " · receipt verified on-chain" : ""}`,
      history: v.nav.history.map((h) => ({ at: new Date(h.at * 1000).toISOString(), pricePerShare: h.pricePerShare, block: h.block })),
    },
    observedSettlementHours: v.settlementObserved.medianHours,
    cutoffNote: v.cutoff.note,
    readBlock: v.blockNumber,
  };
}

/**
 * Vaulto's strategy catalog: every IX High Yield Bond vault the IXS Vault API lists on BNB Chain and Avalanche
 * (open and licensed), plus BTC Real Yield kept as announced / not deployable so the agent can reject idle BTC
 * explicitly. Which vault is actually allocatable is decided per analysis by the pre-flight checks and SERV.
 */
export function buildCatalog(registry: Registry, live: IxsVaultItem[] = []): VaultStrategy[] {
  const out = registry.vaults.map(fromVault);
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
    chainId: 56,
    network: "bsc",
    chainName: "BNB Chain",
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
