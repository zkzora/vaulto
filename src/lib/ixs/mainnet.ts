import { createPublicClient, formatUnits, http } from "viem";
import { avalanche, bsc } from "viem/chains";
import { erc4626Abi } from "@/lib/chain/abi";

/**
 * Read-only view of the IXS production vaults (IX High Yield Bond on BNB Chain and Avalanche).
 * Metadata comes from the IXS production Vault API; TVL is read on-chain (ERC-4626 totalAssets).
 * Nothing here is executable from Vaulto: it is context for the treasury manager.
 */

const PROD_API = "https://api-v2.ixs.finance";
const EXPLORERS: Record<number, string> = { 56: "https://bscscan.com", 43114: "https://snowscan.xyz" };

export interface MainnetVault {
  routeId: string;
  name: string;
  chainId: number;
  chainName: string;
  contractAddress: string;
  asset: string;
  assetDecimals: number;
  requiresWhitelist: boolean;
  status: string;
  apy: number | null;
  tvlUsd: number | null;
  sharePrice: number | null;
  /** Deposit limit reported by the API, when present. */
  limitUsd: number | null;
  explorerUrl: string;
  ixsRewards: { active: boolean; multiplier: number } | null;
}

interface ProdItem {
  routeId: string;
  name: string;
  chainId: number;
  chainName?: string;
  network: string;
  contractAddress: string;
  underlyingAsset?: { symbol: string; decimals: number };
  requiresWhitelist: boolean;
  status: string;
  metrics?: { apy?: number; tvl?: number; depositLimit?: number; limit?: number } | null;
  explorerUrl?: string;
  ixsRewards?: { active: boolean; multiplier: number } | null;
}

let cache: { at: number; value: MainnetVault[] } | null = null;
const TTL_MS = 5 * 60 * 1000;

const clients = {
  56: createPublicClient({ chain: bsc, transport: http(undefined, { timeout: 8_000 }) }),
  43114: createPublicClient({ chain: avalanche, transport: http(undefined, { timeout: 8_000 }) }),
} as const;

export async function getMainnetVaults(): Promise<{ vaults: MainnetVault[]; ok: boolean }> {
  if (cache && Date.now() - cache.at < TTL_MS) return { vaults: cache.value, ok: true };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(`${PROD_API}/vaults`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!res.ok) throw new Error(`IXS prod API ${res.status}`);
    const items = ((await res.json()) as { items: ProdItem[] }).items.filter((v) => v.chainId in clients);

    const vaults: MainnetVault[] = await Promise.all(
      items.map(async (v) => {
        const client = clients[v.chainId as keyof typeof clients];
        const decimals = v.underlyingAsset?.decimals ?? 6;
        let tvlUsd: number | null = null;
        let sharePrice: number | null = null;
        try {
          const addr = v.contractAddress as `0x${string}`;
          const [shareDecimals, total] = await Promise.all([
            client.readContract({ address: addr, abi: erc4626Abi, functionName: "decimals" }).catch(() => 18),
            client.readContract({ address: addr, abi: erc4626Abi, functionName: "totalAssets" }),
          ]);
          const one = await client.readContract({ address: addr, abi: erc4626Abi, functionName: "convertToAssets", args: [10n ** BigInt(Number(shareDecimals))] }).catch(() => null);
          tvlUsd = Number(formatUnits(total, decimals));
          sharePrice = one != null ? Number(formatUnits(one, decimals)) : null;
        } catch {
          // RPC unavailable: leave on-chain numbers empty rather than inventing them
        }
        return {
          routeId: v.routeId,
          name: v.name,
          chainId: v.chainId,
          chainName: v.chainId === 56 ? "BNB Chain" : "Avalanche C-Chain",
          contractAddress: v.contractAddress,
          asset: v.underlyingAsset?.symbol ?? "USDC",
          assetDecimals: decimals,
          requiresWhitelist: v.requiresWhitelist,
          status: v.status,
          apy: v.metrics?.apy ?? null,
          tvlUsd: v.metrics?.tvl ?? tvlUsd,
          sharePrice,
          limitUsd: v.metrics?.depositLimit ?? v.metrics?.limit ?? null,
          explorerUrl: `${EXPLORERS[v.chainId] ?? v.explorerUrl ?? ""}/address/${v.contractAddress}`,
          ixsRewards: v.ixsRewards ?? null,
        };
      }),
    );
    cache = { at: Date.now(), value: vaults };
    return { vaults, ok: true };
  } catch {
    return { vaults: cache?.value ?? [], ok: false };
  }
}
