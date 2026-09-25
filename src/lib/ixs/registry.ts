import { formatUnits } from "viem";
import { erc20Abi, erc4626Abi } from "@/lib/chain/abi";
import { publicClient } from "@/lib/chain/client";
import { CHAINS, IXS_KNOWN_VAULTS, IXS_PRODUCT_ID, MIN_DEPOSIT_USDC, SUPPORTED_CHAIN_IDS, chainInfo } from "@/lib/chain/config";
import { env } from "@/lib/env";
import { recordEvidence } from "@/lib/evidence";
import { chainAt, getReplay, type ChainAt } from "@/lib/replay";
import { vaultGet, type Settlement } from "./mcp";
import { readSubgraphVault, type SubgraphVaultInfo } from "./subgraph";

/**
 * Registry of the IX High Yield Bond vaults on BNB Chain and Avalanche.
 *
 * Addresses come from the IXS Vault API (GET /vaults, product ixhyb); everything that matters for execution is read
 * from the contracts (asset(), decimals, fees, pause, whitelist, deposit limit via maxDeposit(), TVL, price per share)
 * and from the IXS subgraphs (NAV timestamp and history, minimum deposit, deposit-request lifecycle). Nothing about
 * the asset, limits or fees is hardcoded. Every read lands in the evidence log with its block number.
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

/** Address used to read the deposit limit that applies to a brand-new depositor. */
export const PROBE_WALLET = "0x1111111111111111111111111111111111111111" as const;

export interface RegistryVault {
  chainId: number;
  chainName: string;
  apiId: string;
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
  blockNumber: number | null;
  readAt: string;
  /** maxDeposit() for a brand-new depositor: null = unlimited (2^256-1), 0 = closed. */
  depositLimit: { usd: number | null; unlimited: boolean; source: string };
  minDeposit: { usd: number; source: string };
  nav: { pricePerShare: number | null; updatedAt: number | null; ageHours: number | null; block: number | null; lastChangeTx: string | null; lastChangeVerified: boolean; contractThresholdHours: number | null; source: string; history: { at: number; pricePerShare: number; block: number | null; txHash?: string }[] };
  /** Redemption terms read on-chain: minimum (minRedeemAssets) and fee (feeBps); settlement "queued" = request, operator finalizes, no claim. */
  redeem: { minAssetsUsd: number | null; feeBps: number | null; path: string };
  settlementObserved: { samples: number; medianHours: number | null; pendingCount: number };
  cutoff: { known: boolean; note: string };
  /** Set when the IXS MCP and the vault's subgraph family disagree on the settlement kind (the family wins). */
  settlementConflict?: string;
}

export interface Registry {
  vaults: RegistryVault[];
  /** Set in Replay mode: every on-chain read is at this BNB block (Avalanche at its block closest in time). */
  replay?: { block: number; avaxBlock: number | null; label: string } | null;
  /** Address list came from the live API ("api") or the last-known fallback ("fallback"). */
  source: "api" | "fallback";
  apiOk: boolean;
  fetchedAt: string;
}

const TIMEOUT_MS = 8_000;
const TTL_MS = 3 * 60_000;
const caches = new Map<string, { at: number; value: Registry }>();

async function fetchItems(): Promise<IxsVaultItem[] | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(`${env.ixsApiBaseUrl}/vaults`, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`IXS API ${res.status}`);
    const json = (await res.json()) as { items?: IxsVaultItem[] };
    const items = json.items ?? [];
    recordEvidence({ kind: "ixs-api", label: "IXS Vault API · GET /vaults", request: { url: `${env.ixsApiBaseUrl}/vaults` }, response: items.map((v) => ({ id: v.id, routeId: v.routeId, name: v.name, symbol: v.symbol, chainId: v.chainId, contractAddress: v.contractAddress, requiresWhitelist: v.requiresWhitelist, status: v.status, ttm: v.ttm, underlyingAsset: v.underlyingAsset })), ok: true, durationMs: Date.now() - started });
    return items;
  } catch (e) {
    recordEvidence({ kind: "ixs-api", label: "IXS Vault API · GET /vaults", request: { url: `${env.ixsApiBaseUrl}/vaults` }, response: { error: e instanceof Error ? e.message : String(e) }, ok: false, durationMs: Date.now() - started });
    return null;
  } finally {
    clearTimeout(t);
  }
}

type Skeleton = Pick<IxsVaultItem, "id" | "routeId" | "name" | "symbol" | "chainId" | "contractAddress" | "requiresWhitelist" | "status" | "explorerUrl" | "subgraphUrl" | "ttm" | "underlyingAsset">;
type McResult = { status: "success"; result: unknown } | { status: "failure"; error?: unknown; result?: undefined };

const num = (v: unknown, fallback: number | null = null): number | null => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : fallback);
const UINT_MAX = 2n ** 256n - 1n;

async function readChain(chainId: number, list: Skeleton[], at: ChainAt | null = null): Promise<RegistryVault[]> {
  const client = at?.client ?? publicClient(chainId);
  const info = chainInfo(chainId);
  const addr = (s: Skeleton) => s.contractAddress as `0x${string}`;
  const FIELDS = ["asset", "decimals", "totalAssets", "totalSupply", "paused", "whitelistEnabled", "feeBps", "redeemFeeBps", "priceUpdatedAt", "navStalenessThreshold", "minRedeemAssets"] as const;
  let first: McResult[] | null = null;
  let block: bigint | null = null;
  const started = Date.now();
  try {
    [block, first] = await Promise.all([
      client.getBlockNumber(),
      client.multicall({
        allowFailure: true,
        contracts: list.flatMap((s) => [
          ...FIELDS.map((functionName) => ({ address: addr(s), abi: erc4626Abi, functionName })),
          { address: addr(s), abi: erc4626Abi, functionName: "maxDeposit" as const, args: [PROBE_WALLET] as const },
        ]),
      }) as Promise<McResult[]>,
    ]);
  } catch {
    first = null;
  }
  const STRIDE = FIELDS.length + 1;
  const get = (i: number, f: (typeof FIELDS)[number] | "maxDeposit") => {
    const idx = f === "maxDeposit" ? FIELDS.length : FIELDS.indexOf(f);
    const r = first?.[i * STRIDE + idx];
    return r?.status === "success" ? r.result : null;
  };

  const assetAddrs = [...new Set(list.map((_, i) => (get(i, "asset") as string | null)?.toLowerCase()).filter((a): a is string => Boolean(a)))];
  const shareDecimals = list.map((_, i) => Number(get(i, "decimals") ?? 18));
  let second: McResult[] | null = null;
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

  // Subgraph facts (NAV timestamp, minimum deposit, request lifecycle) in parallel for every vault.
  const subgraphs = await Promise.all(list.map((s) => readSubgraphVault(s.subgraphUrl, s.contractAddress, chainId)));

  const out: RegistryVault[] = [];
  const now = at ? at.timestamp : Date.now() / 1000;
  for (const [i, s] of list.entries()) {
    const assetAddr = (get(i, "asset") as string | null)?.toLowerCase() ?? null;
    const meta = assetAddr ? assetMeta.get(assetAddr) : undefined;
    const onchainOk = Boolean(assetAddr && meta);
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
    const maxDep = get(i, "maxDeposit") as bigint | null;
    const sg: SubgraphVaultInfo | null = subgraphs[i];
    // Replay: the subgraph's latest values postdate the replay block, so NAV history is cut at that block and the
    // price comes from convertToAssets() read at the block.
    const navHistory = (sg?.navHistory ?? []).filter((h) => !at || h.block == null || h.block <= Number(at.block));
    const navAtChain = num(get(i, "priceUpdatedAt"));
    const navAt = navAtChain && navAtChain > 0 ? navAtChain : at ? (navHistory[0]?.at ?? null) : (sg?.navUpdatedAt ?? null);
    const thresholdSec = num(get(i, "navStalenessThreshold")) ?? sg?.navStalenessThreshold ?? null;
    const minRedeemRaw = get(i, "minRedeemAssets") as bigint | null;
    const navPps = at ? (one != null ? Number(formatUnits(one, asset.decimals)) : null) : sg?.pricePerShare != null ? Number(formatUnits(sg.pricePerShare, asset.decimals)) : one != null ? Number(formatUnits(one, asset.decimals)) : null;
    const minFromSg = sg?.minDepositAssets != null ? Number(formatUnits(sg.minDepositAssets, asset.decimals)) : null;
    const settlementGuess: Settlement = /7540/i.test(`${s.subgraphUrl ?? ""} ${s.symbol}`) ? "async-erc7540" : "sync";
    out.push({
      chainId,
      chainName: info.name,
      apiId: s.id,
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
      redeemFeeBps: fee ?? sg?.redeemFeeBps ?? null,
      totalAssets: total != null ? Number(formatUnits(total, asset.decimals)) : 0,
      totalSupply: supply != null ? Number(formatUnits(supply, shareDecimals[i])) : 0,
      sharePrice: one != null ? Number(formatUnits(one, asset.decimals)) : null,
      ttm: typeof s.ttm === "number" ? s.ttm : null,
      explorerUrl: `${info.explorer}/address/${s.contractAddress}`,
      subgraphUrl: s.subgraphUrl,
      onchainOk,
      blockNumber: block != null ? Number(block) : null,
      readAt: new Date(now * 1000).toISOString(),
      depositLimit: maxDep == null
        ? { usd: null, unlimited: false, source: "maxDeposit() unavailable" }
        : maxDep >= UINT_MAX / 2n
          ? { usd: null, unlimited: true, source: `maxDeposit(${PROBE_WALLET.slice(0, 6)}…) on-chain = 2^256-1` }
          : { usd: Number(formatUnits(maxDep, asset.decimals)), unlimited: false, source: `maxDeposit(${PROBE_WALLET.slice(0, 6)}…) on-chain, block ${block ?? "?"}` },
      minDeposit: minFromSg != null ? { usd: minFromSg, source: "subgraph minDepositAssets (config change on-chain)" } : { usd: MIN_DEPOSIT_USDC, source: "vault reverts 'below min deposit' under 100 (verified by eth_call) · agent policy" },
      nav: {
        pricePerShare: navPps,
        updatedAt: navAt,
        ageHours: navAt != null ? Math.round(((now - navAt) / 3600) * 10) / 10 : null,
        block: at ? (navHistory[0]?.block ?? null) : (sg?.navUpdatedBlock ?? null),
        lastChangeTx: navHistory[0]?.txHash ?? null,
        lastChangeVerified: false,
        contractThresholdHours: thresholdSec != null ? Math.round((thresholdSec / 3600) * 10) / 10 : null,
        source: navAtChain && navAtChain > 0 ? "priceUpdatedAt() on-chain" + (sg ? " · history from the IXS subgraph (NAV events)" : "") : sg ? (sg.kind === "erc7540" ? "subgraph Vault.priceUpdatedAt / navUpdates (on-chain NAV events)" : "subgraph vaultActivities NAV_UPDATED (on-chain events)") : "unavailable",
        history: navHistory.slice(0, 12).map((h) => ({ at: h.at, pricePerShare: Number(formatUnits(h.pricePerShare, asset.decimals)), block: h.block, txHash: h.txHash })),
      },
      settlementObserved: { samples: sg?.settlement.samples ?? 0, medianHours: sg?.settlement.medianHours ?? null, pendingCount: sg?.settlement.pendingCount ?? 0 },
      redeem: { minAssetsUsd: minRedeemRaw != null ? Number(formatUnits(minRedeemRaw, asset.decimals)) : null, feeBps: fee ?? sg?.redeemFeeBps ?? null, path: "requestRedeem → queued → operator sells RWA and finalizes → USDC paid to the receiver (no claim step)" },
      cutoff: settlementGuess === "sync" ? { known: false, note: "not applicable: sync ERC-4626, settles in the deposit transaction" } : { known: true, note: "17:00 SGT (09:00 UTC) on Singapore business days, requests processed at the next cutoff (IXS stated, 24 Sep 2026); settlement ≈ 1 business day later is a Vaulto estimate" },
    });
  }
  // Cross-check the last NAV change against the chain: the receipt must exist at the block the subgraph reports.
  await Promise.all(
    out.map(async (v) => {
      if (!v.nav.lastChangeTx) return;
      try {
        const receipt = await client.getTransactionReceipt({ hash: v.nav.lastChangeTx as `0x${string}` });
        v.nav.lastChangeVerified = receipt.status === "success" && receipt.logs.some((l) => l.address.toLowerCase() === v.address.toLowerCase());
        if (v.nav.block == null) v.nav.block = Number(receipt.blockNumber);
        recordEvidence({ kind: "onchain", label: `${info.name} · last NAV change receipt ${v.symbol}`, chainId, blockNumber: Number(receipt.blockNumber), request: { txHash: v.nav.lastChangeTx }, response: { status: receipt.status, block: Number(receipt.blockNumber), vaultLogs: receipt.logs.filter((l) => l.address.toLowerCase() === v.address.toLowerCase()).length, navUpdatedAt: v.nav.updatedAt }, ok: v.nav.lastChangeVerified });
      } catch {
        v.nav.lastChangeVerified = false;
      }
    }),
  );
  recordEvidence({
    kind: "onchain",
    label: `${info.name} · vault reads (asset, decimals, totalAssets, supply, paused, whitelist, feeBps, maxDeposit, convertToAssets)`,
    chainId,
    blockNumber: block != null ? Number(block) : null,
    request: { rpc: chainId === 43114 ? env.avaxRpcUrl : env.rpcUrl, vaults: list.map((s) => s.contractAddress), multicall: CHAINS[chainId].multicall },
    response: out.map((v) => ({ vault: v.address, symbol: v.symbol, asset: v.asset, sharePrice: v.sharePrice, totalAssets: v.totalAssets, totalSupply: v.totalSupply, paused: v.paused, whitelistEnabled: v.whitelistEnabled, redeemFeeBps: v.redeemFeeBps, depositLimit: v.depositLimit, navUpdatedAt: v.nav.updatedAt, navAgeHours: v.nav.ageHours, navSource: v.nav.source, navStalenessThresholdHours: v.nav.contractThresholdHours, minRedeemAssets: v.redeem.minAssetsUsd })),
    ok: first != null,
    durationMs: Date.now() - started,
  });
  return out;
}

/**
 * The IX High Yield Bond vaults on every supported chain with on-chain + subgraph state. Cached 3 minutes.
 * In Replay mode (cookie) the on-chain state is read at the replay block; `{ current: true }` always reads today.
 */
export async function getRegistry(opts: { current?: boolean } = {}): Promise<Registry> {
  const replay = opts.current ? null : await getReplay();
  const cacheKey = replay ? `replay:${replay.block}` : "current";
  const cache = caches.get(cacheKey) ?? null;
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const items = await fetchItems();
  const apiOk = items != null;
  const fromApi = (items ?? []).filter((v) => SUPPORTED_CHAIN_IDS.includes(v.chainId) && (v.productId === IXS_PRODUCT_ID || /high yield bond/i.test(v.name)));
  const skeleton: Skeleton[] = fromApi.length
    ? fromApi
    : IXS_KNOWN_VAULTS.map((k) => ({ id: k.routeId, routeId: k.routeId, name: "IX High Yield Bond (USDC)", symbol: k.symbol, chainId: k.chainId, contractAddress: k.address, requiresWhitelist: k.requiresWhitelist, status: "active", explorerUrl: `${chainInfo(k.chainId).explorer}/address/${k.address}` }));

  const byChain = new Map<number, Skeleton[]>();
  for (const s of skeleton) byChain.set(s.chainId, [...(byChain.get(s.chainId) ?? []), s]);
  const vaults = (await Promise.all([...byChain.entries()].map(([chainId, list]) => readChain(chainId, list, replay ? chainAt(replay, chainId) : null)))).flat();

  // Settlement kind from the IXS MCP (vault_get), which is authoritative; the subgraph name is only a guess.
  await Promise.all(
    vaults.map(async (v) => {
      const info = await vaultGet(v.routeId);
      if (info?.settlement === "sync" || info?.settlement === "async-erc7540") {
        // The subgraph family ("ixs-erc7540-vault-*" vs "ixs-managed-vault-*") is structural; never let a single
        // MCP answer contradict it, or SERV would get the wrong settlement kind for the vault.
        if (v.subgraphUrl && info.settlement !== v.settlement) {
          v.settlementConflict = `IXS MCP vault_get returned ${info.settlement}, the vault's subgraph family says ${v.settlement}; kept ${v.settlement}`;
          return;
        }
        v.settlement = info.settlement;
        v.settlementSource = "ixs-mcp";
        if (info.settlement === "sync") v.cutoff = { known: false, note: "not applicable: sync ERC-4626, settles in the deposit transaction" };
      }
    }),
  );
  vaults.sort((a, b) => (a.chainId === 56 ? 0 : 1) - (b.chainId === 56 ? 0 : 1) || Number(a.requiresWhitelist) - Number(b.requiresWhitelist));

  const value: Registry = { vaults, source: fromApi.length ? "api" : "fallback", apiOk, fetchedAt: new Date().toISOString(), replay: replay ? { block: replay.block, avaxBlock: replay.avaxBlock, label: replay.label } : null };
  if (vaults.length && vaults.some((v) => v.onchainOk)) caches.set(cacheKey, { at: Date.now(), value });
  else if (cache) return cache.value;
  return value;
}

export function findRegistryVault(registry: Registry, routeId: string | undefined): RegistryVault | undefined {
  return routeId ? registry.vaults.find((v) => v.routeId === routeId) : undefined;
}
