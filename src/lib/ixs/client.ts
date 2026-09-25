import { encodeFunctionData, isAddress, parseUnits } from "viem";
import { env } from "@/lib/env";
import { erc20Abi, erc4626Abi } from "@/lib/chain/abi";
import { CHAIN_ID, CHAIN_NAME, chainInfo } from "@/lib/chain/config";
import { buildCatalog } from "./catalog";
import { buildDepositRequest, checkWhitelist } from "./mcp";
import { getRegistry, type IxsVaultItem, type Registry } from "./registry";
import type { TxStep, VaultStrategy } from "@/lib/types";

/**
 * IXS adapter layer (production, BNB Chain + Avalanche).
 *
 * READ  — vault registry (IXS Vault API + contract + subgraph reads), catalog, availability of announced products.
 * WRITE — approve + deposit calldata via the IXS MCP (`vault_build_request_deposit`). Direct contract encoding is a
 *         fallback only for non-safety MCP failures (network / upstream errors), never when the MCP refused for
 *         limit, NAV, whitelist or pause reasons, and never when the pre-flight did not pass. IXS approved direct
 *         builds against the verified Avalanche proxy (24 Sep 2026); every step records which builder made it.
 *         Nothing is ever signed or submitted server-side.
 */

export { checkWhitelist };

/** Avalanche proxy IXS explicitly allowed direct contract builds for (verified proxy on Snowtrace). */
export const IXS_DIRECT_BUILD_ALLOWED = new Set(["0xad01573b459805e3954398796203d830b57a8bd9"]);

const TIMEOUT_MS = 8_000;
let liveCache: { at: number; items: IxsVaultItem[] } | null = null;

/** Every vault on the IXS production Vault API (all chains), cached 60s. Used for availability checks. */
export async function fetchLiveVaults(): Promise<{ items: IxsVaultItem[]; ok: boolean }> {
  if (liveCache && Date.now() - liveCache.at < 60_000) return { items: liveCache.items, ok: true };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${env.ixsApiBaseUrl}/vaults`, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`IXS ${res.status}`);
    const json = (await res.json()) as { items?: IxsVaultItem[] };
    const items = json.items ?? [];
    liveCache = { at: Date.now(), items };
    return { items, ok: true };
  } catch {
    return { items: liveCache?.items ?? [], ok: false };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Live availability check against the IXS Vault API: a strategy is available when its vault (routeId) exists, or a
 * vault for its asset exists on a supported chain. Announced products without a vault are not.
 */
export async function vaultAvailability(strategies: VaultStrategy[]): Promise<Record<string, { available: boolean; detail: string }>> {
  const live = await fetchLiveVaults();
  const out: Record<string, { available: boolean; detail: string }> = {};
  for (const s of strategies) {
    const match = live.items.find((v) => (s.routeId ? v.routeId === s.routeId : (v.underlyingAsset?.symbol ?? "").toUpperCase().includes(s.asset.toUpperCase())));
    out[s.id] = match
      ? { available: true, detail: `${s.vaultName}: live on the IXS Vault API (${match.name}, ${match.chainName ?? match.network})` }
      : { available: false, detail: !live.ok ? `${s.vaultName}: IXS Vault API unreachable, availability unknown` : `${s.vaultName}: announced by IXS, no ${s.asset} vault deployed on the IXS Vault API` };
  }
  return out;
}

export interface LiveVaultSummary {
  routeId: string;
  name: string;
  symbol: string;
  chainId: number;
  chainName: string;
  contractAddress: string;
  requiresWhitelist: boolean;
  status: string;
  explorerUrl?: string;
  asset: string;
  strategyId?: string;
}

export interface StrategiesResult {
  strategies: VaultStrategy[];
  liveOk: boolean;
  liveVaults: LiveVaultSummary[];
  registry: { source: Registry["source"]; apiOk: boolean; fetchedAt: string; onchainOk: boolean };
}

/** Catalog built from the registry (addresses from the IXS API, state from the contracts + subgraphs). */
export async function getStrategies(): Promise<StrategiesResult> {
  const [registry, live] = await Promise.all([getRegistry(), fetchLiveVaults()]);
  const strategies = buildCatalog(registry, live.items);
  const liveVaults: LiveVaultSummary[] = live.items.map((v) => ({
    routeId: v.routeId,
    name: v.name,
    symbol: v.symbol,
    chainId: v.chainId,
    chainName: v.chainId === CHAIN_ID ? CHAIN_NAME : chainInfo(v.chainId).name,
    contractAddress: v.contractAddress,
    requiresWhitelist: v.requiresWhitelist,
    status: v.status,
    explorerUrl: `${chainInfo(v.chainId).explorer}/address/${v.contractAddress}`,
    asset: v.underlyingAsset?.symbol ?? "USDC",
    strategyId: strategies.find((s) => s.routeId === v.routeId)?.id,
  }));
  return {
    strategies,
    liveOk: live.ok,
    liveVaults,
    registry: { source: registry.source, apiOk: registry.apiOk, fetchedAt: registry.fetchedAt, onchainOk: registry.vaults.length > 0 && registry.vaults.every((v) => v.onchainOk) },
  };
}

type BuiltStep = Omit<TxStep, "index" | "mode" | "amountUsd">;

/** MCP refusals that are safety verdicts (never bypassed by the local encoder). */
const SAFETY_REFUSAL = /limit|whitelist|paused|exceeds|minimum|below min|not eligible|kyc/i;

/**
 * Approve + deposit sequence for a strategy, in asset units read from the contract.
 * Built by the IXS MCP; the direct ERC-4626 / ERC-7540 encoder is used only when the MCP failed for a non-safety
 * reason AND the caller confirmed the pre-flight passed (`preflightOk`) AND either the run is a simulation or the
 * vault is one IXS allowed direct builds for.
 */
export async function buildDepositSteps(
  strategy: VaultStrategy,
  owner: string,
  amount: number,
  opts: { preflightOk: boolean; simulation: boolean },
): Promise<{ steps: BuiltStep[]; builtBy: "ixs-mcp" | "local-encoder"; note?: string }> {
  if (!strategy.contractAddress || !strategy.assetAddress || strategy.assetDecimals == null) throw new Error("strategy has no contract");
  if (!isAddress(owner)) throw new Error("invalid owner");
  const decimals = strategy.assetDecimals;
  const units = parseUnits(amount.toFixed(Math.min(decimals, 6)), decimals);
  const vault = strategy.contractAddress as `0x${string}`;
  const asset = strategy.assetAddress as `0x${string}`;
  const precheck = { kind: "allowance" as const, token: asset, spender: vault, amount: units.toString() };
  const base = { strategyId: strategy.id, vaultName: strategy.vaultName, chainId: strategy.chainId, amount, asset: strategy.asset, units: units.toString() };

  let mcpError: string | null = null;
  if (strategy.routeId) {
    try {
      const plan = await buildDepositRequest(strategy.routeId, owner, units);
      return {
        builtBy: "ixs-mcp",
        steps: plan.steps!.map((s) => {
          const isApprove = s.type.includes("approve");
          const kind: TxStep["kind"] = isApprove ? "approve" : s.type.includes("request") ? "requestDeposit" : "deposit";
          return {
            ...base,
            kind,
            to: s.tx.to as `0x${string}`,
            data: s.tx.data as `0x${string}`,
            value: s.tx.value ?? "0",
            description: isApprove ? `Approve exactly ${amount.toLocaleString("en-US")} ${strategy.asset} for ${strategy.vaultName} (IXS MCP)` : `${kind === "requestDeposit" ? "Request deposit of" : "Deposit"} ${amount.toLocaleString("en-US")} ${strategy.asset} into ${strategy.vaultName} (IXS MCP)`,
            builtBy: "ixs-mcp" as const,
            ...(isApprove ? {} : { precheck }),
          };
        }),
      };
    } catch (e) {
      mcpError = e instanceof Error ? e.message : "IXS MCP unavailable";
    }
  }

  // The MCP refusing for a safety reason is the verdict: surface it, never encode around it.
  if (mcpError && SAFETY_REFUSAL.test(mcpError)) throw new Error(mcpError);
  if (!opts.preflightOk) throw new Error(`${mcpError ?? "no MCP route"}; pre-flight did not pass, so Vaulto does not build calldata (DEFER)`);
  const directAllowed = opts.simulation || IXS_DIRECT_BUILD_ALLOWED.has(vault.toLowerCase());
  if (!directAllowed) throw new Error(`${mcpError ?? "no MCP route"}; direct contract builds are only allowed for the IXS-approved Avalanche proxy`);

  const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault, units] });
  const deposit =
    strategy.settlement === "sync"
      ? encodeFunctionData({ abi: erc4626Abi, functionName: "deposit", args: [units, owner as `0x${string}`] })
      : encodeFunctionData({ abi: erc4626Abi, functionName: "requestDeposit", args: [units, owner as `0x${string}`, owner as `0x${string}`] });
  const note = `IXS MCP unavailable (${mcpError ?? "no route"}); calldata encoded directly against the verified vault ABI (${strategy.settlement === "sync" ? "ERC-4626 deposit" : "ERC-7540 requestDeposit"})${IXS_DIRECT_BUILD_ALLOWED.has(vault.toLowerCase()) ? ", direct build approved by IXS (24 Sep 2026)" : ", simulation only"}`;
  return {
    builtBy: "local-encoder",
    note,
    steps: [
      { ...base, kind: "approve", to: asset, data: approve, value: "0", description: `Approve exactly ${amount.toLocaleString("en-US")} ${strategy.asset} for ${strategy.vaultName}`, builtBy: "local-encoder" },
      {
        ...base,
        kind: strategy.settlement === "sync" ? "deposit" : "requestDeposit",
        to: vault,
        data: deposit,
        value: "0",
        description: `${strategy.settlement === "sync" ? "Deposit" : "Request deposit of"} ${amount.toLocaleString("en-US")} ${strategy.asset} into ${strategy.vaultName}`,
        builtBy: "local-encoder",
        precheck,
      },
    ],
  };
}
