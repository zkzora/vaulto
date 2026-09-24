import { CHAINS, CHAIN_ID, MAX_LIVE_TX_USDC_DEFAULT, NAV_STALE_HOURS_DEFAULT } from "@/lib/chain/config";

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const env = {
  chainId: CHAIN_ID,
  /** BNB Chain RPC. Point it at http://127.0.0.1:8545 to run the app against an Anvil mainnet fork. */
  rpcUrl: process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || CHAINS[56].defaultRpc,
  /** Avalanche C-Chain RPC (http://127.0.0.1:8546 for a fork). */
  avaxRpcUrl: process.env.AVAX_RPC_URL || process.env.NEXT_PUBLIC_AVAX_RPC_URL || CHAINS[43114].defaultRpc,
  // IXS production Vault API + MCP (BNB Chain and Avalanche vaults).
  ixsApiBaseUrl: (process.env.IXS_API_BASE_URL || "https://api-v2.ixs.finance").replace(/\/$/, ""),
  ixsMcpUrl: process.env.IXS_MCP_URL || "https://api-v2.ixs.finance/mcp",
  // Policy knobs
  navStaleHours: num(process.env.NAV_STALE_HOURS, NAV_STALE_HOURS_DEFAULT),
  maxLiveTxUsdc: num(process.env.MAX_LIVE_TX_USDC, MAX_LIVE_TX_USDC_DEFAULT),
  // OpenServ (no OpenAI key involved).
  //  - inference: OpenServ Inference API, OpenAI-compatible, authenticated with the serv_… key (default)
  //  - platform:  tasks assigned to the Vaulto agent in an OpenServ workspace (needs workspace + agent)
  openservApiKey: process.env.OPENSERV_API_KEY ?? "",
  openservInferenceUrl: (process.env.OPENSERV_INFERENCE_URL ?? "https://inference-api.openserv.ai/v1").replace(/\/$/, ""),
  openservModel: process.env.OPENSERV_MODEL ?? "gpt-5.4-mini",
  openservReasoningMode: (process.env.OPENSERV_REASONING_MODE === "platform" ? "platform" : "inference") as "inference" | "platform",
  openservApiUrl: process.env.OPENSERV_API_URL ?? "https://api.openserv.ai",
  openservWorkspaceId: process.env.OPENSERV_WORKSPACE_ID ?? "",
  openservAgentId: process.env.OPENSERV_AGENT_ID ?? "",
  openservAgentName: process.env.OPENSERV_AGENT_NAME ?? "Vaulto",
  openservTimeoutMs: Number(process.env.OPENSERV_TIMEOUT_MS ?? 90_000),
  databaseUrl: process.env.DATABASE_URL ?? "",
};

export function rpcUrlFor(chainId: number): string {
  return chainId === 43114 ? env.avaxRpcUrl : env.rpcUrl;
}

/** True when Vaulto can hand reasoning to OpenServ (inference key, or platform key + workspace). */
export const openservConfigured = () =>
  Boolean(env.openservApiKey) && (env.openservReasoningMode === "inference" || Boolean(env.openservWorkspaceId));
