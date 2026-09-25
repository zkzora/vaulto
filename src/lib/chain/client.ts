import { createPublicClient, custom, http, numberToHex, type PublicClient } from "viem";
import { CHAIN, CHAINS, EXPLORER, SUPPORTED_CHAIN_IDS, rpcKindOf, type RpcKind } from "./config";
import { env, rpcUrlFor } from "@/lib/env";

const clients = new Map<number, PublicClient>();

/** viem public client for a supported chain (BNB Chain by default). */
export function publicClient(chainId: number = CHAIN.id): PublicClient {
  const id = SUPPORTED_CHAIN_IDS.includes(chainId) ? chainId : CHAIN.id;
  let c = clients.get(id);
  if (!c) {
    c = createPublicClient({ chain: CHAINS[id].chain, transport: http(rpcUrlFor(id), { timeout: 10_000, retryCount: 1 }) }) as PublicClient;
    clients.set(id, c);
  }
  return c;
}

const archiveUrl = (chainId: number) => (chainId === 43114 ? env.avaxArchiveRpcUrl : env.bscArchiveRpcUrl);
const archives = new Map<number, PublicClient>();

/** Archive RPC client at the chain head (used to look blocks up for Replay). */
export function archiveClient(chainId: number): PublicClient {
  let c = archives.get(chainId);
  if (!c) {
    c = createPublicClient({ chain: CHAINS[chainId].chain, transport: http(archiveUrl(chainId), { timeout: 15_000, retryCount: 1 }) }) as PublicClient;
    archives.set(chainId, c);
  }
  return c;
}

const pinned = new Map<string, PublicClient>();
/** JSON-RPC methods whose block tag Replay rewrites, with the position of that parameter. */
const BLOCK_PARAM: Record<string, number> = { eth_call: 1, eth_estimateGas: 1, eth_getBalance: 1, eth_getCode: 1, eth_getTransactionCount: 1, eth_getStorageAt: 2 };

/**
 * Replay client: every read runs at a fixed past block. The transport rewrites "latest" (or a missing tag) to that
 * block and answers eth_blockNumber with it, so multicall, eth_call with state overrides and gas estimates all see
 * the mainnet state of that block through the archive RPC.
 */
export function pinnedClient(chainId: number, block: bigint): PublicClient {
  const key = `${chainId}:${block}`;
  let c = pinned.get(key);
  if (c) return c;
  const chain = CHAINS[chainId].chain;
  const base = http(archiveUrl(chainId), { timeout: 20_000, retryCount: 1 })({ chain });
  const tag = numberToHex(block);
  const transport = custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      if (method === "eth_blockNumber") return tag;
      const p = Array.isArray(params) ? [...params] : [];
      if (method === "eth_getBlockByNumber" && (p[0] === "latest" || p[0] === "pending" || p[0] === "safe" || p[0] === "finalized")) p[0] = tag;
      const i = BLOCK_PARAM[method];
      if (i != null && (p[i] == null || p[i] === "latest" || p[i] === "pending")) {
        while (p.length < i) p.push(null);
        p[i] = tag;
      }
      return base.request({ method, params: p } as never);
    },
  });
  c = createPublicClient({ chain, transport }) as PublicClient;
  pinned.set(key, c);
  return c;
}

/** "fork" when the RPC for that chain points at a local Anvil fork, otherwise "mainnet". */
export function rpcKind(chainId: number = CHAIN.id): RpcKind {
  return rpcKindOf(rpcUrlFor(chainId));
}

/** Kept for callers that only care about the home chain. */
export const RPC_KIND = rpcKindOf(env.rpcUrl);

export { CHAIN, EXPLORER };
