import { createPublicClient, http, type PublicClient } from "viem";
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

/** "fork" when the RPC for that chain points at a local Anvil fork, otherwise "mainnet". */
export function rpcKind(chainId: number = CHAIN.id): RpcKind {
  return rpcKindOf(rpcUrlFor(chainId));
}

/** Kept for callers that only care about the home chain. */
export const RPC_KIND = rpcKindOf(env.rpcUrl);

export { CHAIN, EXPLORER };
