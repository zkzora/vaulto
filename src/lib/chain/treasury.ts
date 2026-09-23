import { formatUnits, isAddress } from "viem";
import { publicClient } from "./client";
import { erc20Abi, erc4626Abi } from "./abi";
import { CHAIN_ID, IXS_BSC, IXS_USDC_SYMBOL, STRATEGY_IDS } from "./config";
import type { OnchainReadout } from "@/lib/types";

const empty = (error?: string): OnchainReadout => ({
  rpcOk: false,
  chainId: CHAIN_ID,
  blockNumber: null,
  nativeBalance: 0,
  balances: {},
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

/** Contracts Vaulto tracks on BSC Testnet: the IXS test USDC and the IXS vaults. */
export const TRACKED = {
  tokens: [{ key: IXS_USDC_SYMBOL, address: IXS_BSC.usdc, decimals: IXS_BSC.usdcDecimals }],
  vaults: [
    { id: STRATEGY_IDS.hybrid, address: IXS_BSC.hybridVault, assetDecimals: IXS_BSC.usdcDecimals },
    { id: STRATEGY_IDS.licensed, address: IXS_BSC.licensedVault, assetDecimals: IXS_BSC.usdcDecimals },
  ],
};

/**
 * Reads the wallet's real state on BSC Testnet in one Multicall3 round-trip (consistent block):
 * native tBNB, IXS test USDC, and shares in the IXS vaults.
 */
export async function readOnchainTreasury(address: string): Promise<OnchainReadout> {
  if (!isAddress(address)) return empty("invalid address");
  const key = address.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  // Public RPC nodes can lag a few blocks; after a confirmed tx insist on a node that has reached it.
  const floor = minBlock.get(key) ?? 0;
  let last: OnchainReadout = empty();
  for (let attempt = 0; attempt < 6; attempt++) {
    last = await readOnce(address as `0x${string}`);
    if (last.rpcOk && (last.blockNumber ?? 0) >= floor) break;
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  if (last.rpcOk) cache.set(key, { at: Date.now(), value: last });
  return last;
}

async function readOnce(owner: `0x${string}`): Promise<OnchainReadout> {
  const client = publicClient();
  const { tokens: tokenList, vaults: vaultList } = TRACKED;

  try {
    const contracts = [
      ...tokenList.map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf" as const, args: [owner] as const })),
      ...vaultList.flatMap((v) => [
        { address: v.address, abi: erc4626Abi, functionName: "decimals" as const },
        { address: v.address, abi: erc4626Abi, functionName: "balanceOf" as const, args: [owner] as const },
        { address: v.address, abi: erc4626Abi, functionName: "totalAssets" as const },
      ]),
    ];
    const [block, native, results] = await Promise.all([
      client.getBlockNumber(),
      client.getBalance({ address: owner }),
      client.multicall({ contracts, allowFailure: true }),
    ]);
    const val = (i: number): bigint | number | null => (results[i]?.status === "success" ? (results[i].result as bigint | number) : null);

    const balances: Record<string, number> = {};
    tokenList.forEach((t, i) => {
      const b = val(i);
      if (b == null) throw new Error(`balanceOf failed for ${t.key}`);
      balances[t.key] = Number(formatUnits(b as bigint, t.decimals));
    });

    const base = tokenList.length;
    const shareDecimals: number[] = [];
    const shareBalances: bigint[] = [];
    const totals: bigint[] = [];
    vaultList.forEach((_, i) => {
      shareDecimals.push(Number(val(base + i * 3) ?? 18));
      shareBalances.push((val(base + i * 3 + 1) as bigint | null) ?? 0n);
      totals.push((val(base + i * 3 + 2) as bigint | null) ?? 0n);
    });

    const conv = await client.multicall({
      allowFailure: true,
      contracts: vaultList.flatMap((v, i) => [
        { address: v.address, abi: erc4626Abi, functionName: "convertToAssets" as const, args: [10n ** BigInt(shareDecimals[i])] as const },
        { address: v.address, abi: erc4626Abi, functionName: "convertToAssets" as const, args: [shareBalances[i]] as const },
      ]),
    });

    const vaults: OnchainReadout["vaults"] = {};
    const positions: OnchainReadout["positions"] = [];
    vaultList.forEach((v, i) => {
      const unit = conv[i * 2]?.status === "success" ? (conv[i * 2].result as bigint) : 0n;
      const mine = conv[i * 2 + 1]?.status === "success" ? (conv[i * 2 + 1].result as bigint) : 0n;
      vaults[v.id] = { address: v.address, tvl: Number(formatUnits(totals[i], v.assetDecimals)), sharePrice: Number(formatUnits(unit, v.assetDecimals)) };
      const shares = Number(formatUnits(shareBalances[i], shareDecimals[i]));
      if (shares > 0) positions.push({ strategyId: v.id, shares, assets: Number(formatUnits(mine, v.assetDecimals)) });
    });

    return {
      rpcOk: true,
      chainId: CHAIN_ID,
      blockNumber: Number(block),
      nativeBalance: Number(formatUnits(native, 18)),
      balances,
      positions,
      vaults,
    };
  } catch (e) {
    return empty(e instanceof Error ? e.message.slice(0, 160) : "rpc error");
  }
}
