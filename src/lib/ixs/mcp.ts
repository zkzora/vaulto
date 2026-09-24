import { env } from "@/lib/env";

/**
 * IXS MCP client (JSON-RPC 2.0 over Streamable HTTP, production endpoint).
 * Tools used: vault_get, vault_check_whitelist, vault_build_request_deposit, vault_request_status.
 * The MCP only builds unsigned calldata; nothing is ever signed or submitted server-side.
 */

const TIMEOUT_MS = 8_000;

interface JsonRpcResult<T> {
  result?: T;
  error?: { code: number; message: string };
}

export interface McpToolResult {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

function parseSse<T>(text: string): JsonRpcResult<T> | null {
  const lines = text.split("\n").filter((l) => l.startsWith("data:"));
  for (const line of lines.reverse()) {
    try {
      return JSON.parse(line.slice(5).trim()) as JsonRpcResult<T>;
    } catch {
      // try next
    }
  }
  return null;
}

export async function mcpCall<T = McpToolResult>(tool: string, args: Record<string, unknown>): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(env.ixsMcpUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: tool, arguments: args } }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    const text = await res.text();
    const parsed: JsonRpcResult<T> | null = text.trim().startsWith("{") ? (JSON.parse(text) as JsonRpcResult<T>) : parseSse<T>(text);
    if (!parsed) throw new Error("IXS MCP: empty response");
    if (parsed.error) throw new Error(`IXS MCP ${tool}: ${parsed.error.message}`);
    return parsed.result as T;
  } finally {
    clearTimeout(t);
  }
}

export function unwrap<T>(r: McpToolResult): T | null {
  if (r.structuredContent) return r.structuredContent as T;
  const text = r.content?.find((c) => c.type === "text")?.text;
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function mcpErrorText(r: McpToolResult) {
  return r.content?.find((c) => c.type === "text")?.text ?? "IXS MCP error";
}

export type Settlement = "sync" | "async-erc7540";

export interface McpVaultGet {
  ok?: boolean;
  settlement?: Settlement | "queued";
  vault?: Record<string, unknown>;
}

const vaultGetCache = new Map<string, { at: number; value: McpVaultGet | null }>();
const VAULT_GET_TTL = 10 * 60_000;

/** `vault_get`: metadata plus the settlement kind (sync vs async ERC-7540). Cached 10 minutes. */
export async function vaultGet(vaultId: string): Promise<McpVaultGet | null> {
  const hit = vaultGetCache.get(vaultId);
  if (hit && Date.now() - hit.at < VAULT_GET_TTL) return hit.value;
  try {
    const r = await mcpCall("vault_get", { vaultId });
    const value = r.isError ? null : unwrap<McpVaultGet>(r);
    vaultGetCache.set(vaultId, { at: Date.now(), value });
    return value;
  } catch {
    return hit?.value ?? null;
  }
}

/** `vault_check_whitelist`: true / false, or null when the MCP could not answer. */
export async function checkWhitelist(vaultId: string, wallet: string): Promise<boolean | null> {
  try {
    const r = await mcpCall("vault_check_whitelist", { vaultId, walletAddress: wallet });
    if (r.isError) return null;
    const data = unwrap<{ whitelisted?: boolean; isWhitelisted?: boolean }>(r);
    return data?.whitelisted ?? data?.isWhitelisted ?? null;
  } catch {
    return null;
  }
}

export interface McpDepositStep {
  type: string;
  description?: string;
  tx: { to: string; data: string; value?: string };
}

export interface McpDepositPlan {
  ok?: boolean;
  settlement?: Settlement;
  asset?: { symbol?: string; decimals?: number; address?: string };
  amount?: { baseUnits?: string; decimals?: number };
  steps?: McpDepositStep[];
}

/** `vault_build_request_deposit`: approve + deposit calldata for `owner`. Throws with the MCP's message when it refuses. */
export async function buildDepositRequest(vaultId: string, owner: string, units: bigint): Promise<McpDepositPlan> {
  const r = await mcpCall("vault_build_request_deposit", { vaultId, ownerAddress: owner, assetAmount: units.toString() });
  if (r.isError) throw new Error(`IXS MCP: ${mcpErrorText(r)}`);
  const plan = unwrap<McpDepositPlan>(r);
  if (!plan?.steps?.length) throw new Error("IXS MCP returned no transaction steps");
  return plan;
}

/** `vault_request_status`: pending / claimable deposit and redeem requests of a wallet on an async vault. */
export async function requestStatus(vaultId: string, wallet: string): Promise<unknown> {
  try {
    const r = await mcpCall("vault_request_status", { vaultId, walletAddress: wallet });
    return r.isError ? { error: mcpErrorText(r) } : (unwrap<unknown>(r) ?? r);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "request status unavailable" };
  }
}
