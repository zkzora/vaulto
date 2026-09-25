import { formatUnits, isAddress } from "viem";
import { publicClient, rpcKind } from "./client";
import { erc20Abi, erc4626Abi } from "./abi";
import { CHAIN_ID, chainInfo, strategyIdFor } from "./config";
import { getRegistry } from "@/lib/ixs/registry";
import { chainAt, getReplay } from "@/lib/replay";
import type { OnchainReadout } from "@/lib/types";

const empty = (error?: string): OnchainReadout => ({
  rpcOk: false,
  rpcKind: rpcKind(CHAIN_ID),
  chainId: CHAIN_ID,
  blockNumber: null,
  nativeBalance: 0,
  balances: {},
  byChain: {},
  positions: [],
  vaults: {},
  error,
});

const cache = new Map<string, { at: number; value: OnchainReadout }>();
const minBlock = new Map<string, number>();
const CACHE_MS = 4_000;

/** Drop the cached readout after a transaction changed the wallet state. */
export function invalidateOnchain(address: string, confirmedBlock?: number) {
  const key = address.toLowerCase();
  cache.delete(key);
  if (confirmedBlock) minBlock.set(key, Math.max(minBlock.get(key) ?? 0, confirmedBlock));
}

/**
 * Reads the wallet's real state on every supported chain (one Multicall3 round-trip per chain): native token,
 * the vault asset (USDC, as read from asset()) and shares in the IXS vaults from the registry.
 * `balances` aggregates USDC across chains; `byChain` keeps the per-chain figures Live mode needs.
 */
export async function readOnchainTreasury(address: string): Promise<OnchainReadout> {
  if (!isAddress(address)) return empty("invalid address");
  const replay = await getReplay();
  const key = `${address.toLowerCase()}${replay ? `@${replay.block}` : ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  // Public RPC nodes can lag a few blocks; after a confirmed tx insist on a node that has reached it.
  const floor = replay ? 0 : (minBlock.get(key) ?? 0);
  let last: OnchainReadout = empty();
  for (let attempt = 0; attempt < 6; attempt++) {
    last = await readOnce(address as `0x${string}`);
    if (last.rpcOk && (last.blockNumber ?? 0) >= floor) break;
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  if (last.rpcOk) cache.set(key, { at: Date.now(), value: last });
  return last;
}

async function readChain(chainId: number, owner: `0x${string}`, vaults: { id: string; address: `0x${string}`; assetDecimals: number; assetSymbol: string; shareDecimals: number }[], tokens: { key: string; address: `0x${string}`; decimals: number }[]) {
  const replay = await getReplay();
  const client = replay ? chainAt(replay, chainId).client : publicClient(chainId);
  const contracts = [
    ...tokens.map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf" as const, args: [owner] as const })),
    ...vaults.flatMap((v) => [
      { address: v.address, abi: erc4626Abi, functionName: "balanceOf" as const, args: [owner] as const },
      { address: v.address, abi: erc4626Abi, functionName: "totalAssets" as const },
    ]),
  ];
  const [block, native, results] = await Promise.all([client.getBlockNumber(), client.getBalance({ address: owner }), client.multicall({ contracts, allowFailure: true })]);
  const val = (i: number): bigint | null => (results[i]?.status === "success" ? (results[i].result as bigint) : null);
  const balances: Record<string, number> = {};
  tokens.forEach((t, i) => {
    const b = val(i);
    if (b == null) throw new Error(`balanceOf failed for ${t.key} on chain ${chainId}`);
    balances[t.key] = (balances[t.key] ?? 0) + Number(formatUnits(b, t.decimals));
  });
  const base = tokens.length;
  const shareBalances = vaults.map((_, i) => val(base + i * 2) ?? 0n);
  const totals = vaults.map((_, i) => val(base + i * 2 + 1) ?? 0n);
  const conv = await client.multicall({
    allowFailure: true,
    contracts: vaults.flatMap((v, i) => [
      { address: v.address, abi: erc4626Abi, functionName: "convertToAssets" as const, args: [10n ** BigInt(v.shareDecimals)] as const },
      { address: v.address, abi: erc4626Abi, functionName: "convertToAssets" as const, args: [shareBalances[i]] as const },
    ]),
  });
  const vaultState: OnchainReadout["vaults"] = {};
  const positions: OnchainReadout["positions"] = [];
  vaults.forEach((v, i) => {
    const unit = conv[i * 2]?.status === "success" ? (conv[i * 2].result as bigint) : 0n;
    const mine = conv[i * 2 + 1]?.status === "success" ? (conv[i * 2 + 1].result as bigint) : 0n;
    vaultState[v.id] = { address: v.address, tvl: Number(formatUnits(totals[i], v.assetDecimals)), sharePrice: Number(formatUnits(unit, v.assetDecimals)), chainId };
    const shares = Number(formatUnits(shareBalances[i], v.shareDecimals));
    if (shares > 0) positions.push({ strategyId: v.id, shares, assets: Number(formatUnits(mine, v.assetDecimals)), chainId });
  });
  return { blockNumber: Number(block), native: Number(formatUnits(native, 18)), balances, vaultState, positions };
}

async function readOnce(owner: `0x${string}`): Promise<OnchainReadout> {
  const registry = await getRegistry();
  if (!registry.vaults.length) return empty("IXS vault registry unavailable");
  const chainIds = [...new Set(registry.vaults.map((v) => v.chainId))];
  const perChain = await Promise.all(
    chainIds.map(async (chainId) => {
      const list = registry.vaults.filter((v) => v.chainId === chainId);
      const vaults = list.map((v) => ({ id: strategyIdFor(v.chainId, v.requiresWhitelist), address: v.address, assetDecimals: v.asset.decimals, assetSymbol: v.asset.symbol, shareDecimals: v.shareDecimals }));
      const tokens = [...new Map(list.map((v) => [v.asset.address.toLowerCase(), { key: v.asset.symbol, address: v.asset.address, decimals: v.asset.decimals }])).values()];
      try {
        const r = await readChain(chainId, owner, vaults, tokens);
        return { chainId, ok: true as const, ...r };
      } catch (e) {
        return { chainId, ok: false as const, error: e instanceof Error ? e.message.slice(0, 160) : "rpc error" };
      }
    }),
  );

  const home = perChain.find((c) => c.chainId === CHAIN_ID);
  if (!home?.ok) return empty(home && !home.ok ? home.error : "home chain unavailable");

  const balances: Record<string, number> = {};
  const byChain: OnchainReadout["byChain"] = {};
  const positions: OnchainReadout["positions"] = [];
  const vaults: OnchainReadout["vaults"] = {};
  for (const c of perChain) {
    const info = chainInfo(c.chainId);
    if (!c.ok) {
      byChain[c.chainId] = { rpcOk: false, rpcKind: rpcKind(c.chainId), blockNumber: null, native: 0, nativeSymbol: info.nativeSymbol, balances: {}, error: c.error };
      continue;
    }
    byChain[c.chainId] = { rpcOk: true, rpcKind: rpcKind(c.chainId), blockNumber: c.blockNumber, native: c.native, nativeSymbol: info.nativeSymbol, balances: c.balances };
    for (const [k, v] of Object.entries(c.balances)) balances[k] = (balances[k] ?? 0) + v;
    positions.push(...c.positions);
    Object.assign(vaults, c.vaultState);
  }

  return {
    rpcOk: true,
    rpcKind: rpcKind(CHAIN_ID),
    chainId: CHAIN_ID,
    blockNumber: home.blockNumber,
    nativeBalance: home.native,
    balances,
    byChain,
    positions,
    vaults,
    assetSymbol: Object.keys(balances)[0],
  };
}
