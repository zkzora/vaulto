import { formatUnits } from "viem";
import { erc20Abi, erc4626Abi } from "@/lib/chain/abi";
import { publicClient } from "@/lib/chain/client";
import { CHAIN_ID, EXPLORER, IXS_KNOWN_VAULTS, IXS_PRODUCT_ID } from "@/lib/chain/config";
import { env } from "@/lib/env";
import { vaultGet, type Settlement } from "./mcp";

/**
 * Registry of the IX High Yield Bond vaults Vaulto targets on BNB Chain.
 *
 * Addresses come from the IXS Vault API (GET /vaults, chain 56, product ixhyb); everything that matters for
 * execution is read from the contracts themselves: asset(), asset decimals/symbol, share decimals, fees,
 * pause and whitelist state, TVL and price per share. Nothing about the asset is hardcoded.
 */

/** Item from GET {IXS_API}/vaults (production). */
export interface IxsVaultItem {
  id: string;
  routeId: string;
  name: string;
  symbol: string;
  chainId: number;
  network: string;
  chainName?: string;
  contractAddress: string;
  explorerUrl?: string;
  subgraphUrl?: string;
  underlyingAsset?: { symbol: string; decimals: number; address: string };
  productId?: string;
  requiresWhitelist: boolean;
  status: string;
  /** Trailing-twelve-month return in %, when the API reports it. */
  ttm?: number | null;
  metrics?: { apy?: number; tvl?: number; depositLimit?: number; limit?: number } | null;
  ixsRewards?: { active: boolean; multiplier: number } | null;
}

export interface RegistryVault {
  routeId: string;
  address: `0x${string}`;
  name: string;
  symbol: string;
  requiresWhitelist: boolean;
  status: string;
  settlement: Settlement;
  settlementSource: "ixs-mcp" | "subgraph" | "default";
  /** Deposit asset, read from asset() + the token contract. */
  asset: { address: `0x${string}`; symbol: string; decimals: number; name: string };
  shareDecimals: number;
  whitelistEnabled: boolean | null;
  paused: boolean;
  /** Redemption fee in basis points, read from feeBps() / redeemFeeBps(); null when the contract exposes neither. */
  redeemFeeBps: number | null;
  totalAssets: number;
  totalSupply: number;
  sharePrice: number | null;
  ttm: number | null;
  explorerUrl: string;
  subgraphUrl?: string;
  onchainOk: boolean;
}

export interface Registry {
  vaults: RegistryVault[];
  /** Address list came from the live API ("api") or the last-known fallback ("fallback"). */
  source: "api" | "fallback";
  apiOk: boolean;
  fetchedAt: string;
}

const TIMEOUT_MS = 8_000;
const TTL_MS = 5 * 60_000;
let cache: { at: number; value: Registry } | null = null;

async function fetchItems(): Promise<IxsVaultItem[] | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${env.ixsApiBaseUrl}/vaults`, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`IXS API ${res.status}`);
    const json = (await res.json()) as { items?: IxsVaultItem[] };
    return json.items ?? [];
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

type Skeleton = Pick<IxsVaultItem, "routeId" | "name" | "symbol" | "contractAddress" | "requiresWhitelist" | "status" | "explorerUrl" | "subgraphUrl" | "ttm" | "underlyingAsset">;

type McResult = { status: "success"; result: unknown } | { status: "failure"; error?: unknown; result?: undefined };

const num = (v: unknown, fallback: number | null = null): number | null => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : fallback);

async function readOnchain(list: Skeleton[]): Promise<RegistryVault[]> {
  const client = publicClient();
  const addr = (s: Skeleton) => s.contractAddress as `0x${string}`;
  const FIELDS = ["asset", "decimals", "totalAssets", "totalSupply", "paused", "whitelistEnabled", "feeBps", "redeemFeeBps"] as const;
  let first: McResult[] | null = null;
  try {
    first = (await client.multicall({
      allowFailure: true,
      contracts: list.flatMap((s) => FIELDS.map((functionName) => ({ address: addr(s), abi: erc4626Abi, functionName }))),
    })) as McResult[];
  } catch {
    first = null;
  }
  const get = (i: number, f: (typeof FIELDS)[number]) => {
    const r = first?.[i * FIELDS.length + FIELDS.indexOf(f)];
    return r?.status === "success" ? r.result : null;
  };

  // Asset token metadata (one call per distinct asset) and price per share.
  const assetAddrs = [...new Set(list.map((_, i) => (get(i, "asset") as string | null)?.toLowerCase()).filter((a): a is string => Boolean(a)))];
  let second: McResult[] | null = null;
  const shareDecimals = list.map((_, i) => Number(get(i, "decimals") ?? 18));
  try {
    second = (await client.multicall({
      allowFailure: true,
      contracts: [
        ...assetAddrs.flatMap((a) => [
          { address: a as `0x${string}`, abi: erc20Abi, functionName: "symbol" as const },
          { address: a as `0x${string}`, abi: erc20Abi, functionName: "decimals" as const },
          { address: a as `0x${string}`, abi: erc20Abi, functionName: "name" as const },
        ]),
        ...list.map((s, i) => ({ address: addr(s), abi: erc4626Abi, functionName: "convertToAssets" as const, args: [10n ** BigInt(shareDecimals[i])] as const })),
      ],
    })) as McResult[];
  } catch {
    second = null;
  }
  const assetMeta = new Map<string, { symbol: string; decimals: number; name: string }>();
  assetAddrs.forEach((a, i) => {
    const sym = second?.[i * 3]?.status === "success" ? String(second[i * 3].result) : null;
    const dec = second?.[i * 3 + 1]?.status === "success" ? Number(second[i * 3 + 1].result) : null;
    const name = second?.[i * 3 + 2]?.status === "success" ? String(second[i * 3 + 2].result) : null;
    if (sym != null && dec != null) assetMeta.set(a, { symbol: sym, decimals: dec, name: name ?? sym });
  });

  const out: RegistryVault[] = [];
  for (const [i, s] of list.entries()) {
    const assetAddr = (get(i, "asset") as string | null)?.toLowerCase() ?? null;
    const meta = assetAddr ? assetMeta.get(assetAddr) : undefined;
    const onchainOk = Boolean(assetAddr && meta);
    // Fallback to the API's description of the asset only when the RPC could not answer.
    const asset = onchainOk
      ? { address: assetAddr as `0x${string}`, symbol: meta!.symbol, decimals: meta!.decimals, name: meta!.name }
      : s.underlyingAsset
        ? { address: s.underlyingAsset.address as `0x${string}`, symbol: s.underlyingAsset.symbol, decimals: s.underlyingAsset.decimals, name: s.underlyingAsset.symbol }
        : null;
    if (!asset) continue;
    const total = get(i, "totalAssets") as bigint | null;
    const supply = get(i, "totalSupply") as bigint | null;
    const conv = second?.[assetAddrs.length * 3 + i];
    const one = conv?.status === "success" ? (conv.result as bigint) : null;
    const fee = num(get(i, "feeBps")) ?? num(get(i, "redeemFeeBps"));
    const wl = get(i, "whitelistEnabled");
    const settlementGuess: Settlement = /7540/i.test(`${s.subgraphUrl ?? ""} ${s.symbol}`) ? "async-erc7540" : "sync";
    out.push({
      routeId: s.routeId,
      address: addr(s),
      name: s.name,
      symbol: s.symbol,
      requiresWhitelist: s.requiresWhitelist,
      status: s.status,
      settlement: settlementGuess,
      settlementSource: "subgraph",
      asset,
      shareDecimals: shareDecimals[i],
      whitelistEnabled: typeof wl === "boolean" ? wl : null,
      paused: get(i, "paused") === true,
      redeemFeeBps: fee,
      totalAssets: total != null ? Number(formatUnits(total, asset.decimals)) : 0,
      totalSupply: supply != null ? Number(formatUnits(supply, shareDecimals[i])) : 0,
      sharePrice: one != null ? Number(formatUnits(one, asset.decimals)) : null,
      ttm: typeof s.ttm === "number" ? s.ttm : null,
      explorerUrl: s.explorerUrl ?? `${EXPLORER}/address/${s.contractAddress}`,
      subgraphUrl: s.subgraphUrl,
      onchainOk,
    });
  }
  return out;
}

/** The BNB Chain IX High Yield Bond vaults with live on-chain state. Cached 5 minutes; last good value kept on failure. */
export async function getRegistry(): Promise<Registry> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const items = await fetchItems();
  const apiOk = items != null;
  const fromApi = (items ?? []).filter((v) => v.chainId === CHAIN_ID && (v.productId === IXS_PRODUCT_ID || /high yield bond/i.test(v.name)));
  const skeleton: Skeleton[] = fromApi.length
    ? fromApi
    : IXS_KNOWN_VAULTS.map((k) => ({ routeId: k.routeId, name: "IX High Yield Bond (USDC)", symbol: k.symbol, contractAddress: k.address, requiresWhitelist: k.requiresWhitelist, status: "active", explorerUrl: `${EXPLORER}/address/${k.address}` }));

  const vaults = await readOnchain(skeleton);
  // Settlement kind from the IXS MCP (vault_get), which is authoritative; the subgraph name is only a guess.
  await Promise.all(
    vaults.map(async (v) => {
      const info = await vaultGet(v.routeId);
      if (info?.settlement === "sync" || info?.settlement === "async-erc7540") {
        v.settlement = info.settlement;
        v.settlementSource = "ixs-mcp";
      }
    }),
  );

  const value: Registry = { vaults, source: fromApi.length ? "api" : "fallback", apiOk, fetchedAt: new Date().toISOString() };
  if (vaults.length && vaults.every((v) => v.onchainOk)) cache = { at: Date.now(), value };
  else if (cache) return cache.value;
  return value;
}

/** Strategy id for a registry vault: the whitelist-gated one is "licensed", the open one "hybrid". */
export function strategyIdFor(v: RegistryVault, ids: { hybrid: string; licensed: string }) {
  return v.requiresWhitelist ? ids.licensed : ids.hybrid;
}
