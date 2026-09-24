import { createPublicClient, http } from "viem";
import { CHAIN, EXPLORER, rpcKindOf } from "./config";
import { env } from "@/lib/env";

const client = createPublicClient({
  chain: CHAIN,
  transport: http(env.rpcUrl, { timeout: 10_000, retryCount: 1 }),
});

export function publicClient() {
  return client;
}

/** "fork" when RPC_URL points at a local Anvil fork of BNB mainnet, otherwise "mainnet". */
export const RPC_KIND = rpcKindOf(env.rpcUrl);

export { CHAIN, EXPLORER };
