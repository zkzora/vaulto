import { createPublicClient, http } from "viem";
import { CHAIN, EXPLORER } from "./config";
import { env } from "@/lib/env";

const client = createPublicClient({
  chain: CHAIN,
  transport: http(env.rpcUrl, { timeout: 8_000, retryCount: 1 }),
});

export function publicClient() {
  return client;
}

export { CHAIN, EXPLORER };
