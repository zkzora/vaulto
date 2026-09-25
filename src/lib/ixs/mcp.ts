import { env } from "@/lib/env";
import { recordEvidence } from "@/lib/evidence";

/**
 * IXS MCP client (JSON-RPC 2.0 over Streamable HTTP, production endpoint).
 * Tools used: vault_get, vault_check_whitelist, vault_build_request_deposit, vault_request_status.
 * The MCP only builds unsigned calldata; nothing is ever signed or submitted server-side.
 * Every call and its response is written to the evidence log.
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
  const started = Date.now();
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
    const result = parsed.result as T;
    const r = result as unknown as McpToolResult;
    recordEvidence({ kind: "mcp", label: `IXS MCP · ${tool}`, request: { url: env.ixsMcpUrl, tool, arguments: args }, response: r?.structuredContent ?? r?.content?.find((c) => c.type === "text")?.text ?? result, ok: !r?.isError, durationMs: Date.now() - started });
    return result;
  } catch (e) {
    recordEvidence({ kind: "mcp", label: `IXS MCP · ${tool}`, request: { url: env.ixsMcpUrl, tool, arguments: args }, response: { error: e instanceof Error ? e.message : String(e) }, ok: false, durationMs: Date.now() - started });
    throw e;
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
  pricing?: { totalAssets?: string; totalSupply?: string; pricePerShare?: string };
  vault?: Record<string, unknown>;
}

const vaultGetCache = new Map<string, { at: number; value: McpVaultGet | null }>();
const VAULT_GET_TTL = 10 * 60_000;

/** `vault_get`: metadata, pricing and the settlement kind (sync vs async ERC-7540). Cached 10 minutes. */
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

/**
 * Probe: would the MCP build a deposit of `units` for `owner`? Returns the refusal text when it will not
 * (e.g. "Deposit amount exceeds the current vault limit of 0 USDC."). Used by the pre-flight checks.
 */
export async function probeDeposit(vaultId: string, owner: string, units: bigint): Promise<{ ok: true; settlement?: Settlement } | { ok: false; reason: string }> {
  try {
    const plan = await buildDepositRequest(vaultId, owner, units);
    return { ok: true, settlement: plan.settlement };
  } catch (e) {
    return { ok: false, reason: (e instanceof Error ? e.message : String(e)).replace(/^IXS MCP:\s*/, "") };
  }
}

/** `vault_request_status` (upstream currently answers with a subgraph schema error; callers fall back to the subgraph). */
export async function requestStatus(vaultId: string, wallet: string): Promise<unknown> {
  try {
    const r = await mcpCall("vault_request_status", { vaultId, ownerAddress: wallet });
    return r.isError ? { error: mcpErrorText(r) } : (unwrap<unknown>(r) ?? r);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "request status unavailable" };
  }
}

export interface McpRedeemPlan {
  ok?: boolean;
  settlement?: Settlement | "queued";
  shares?: { baseUnits?: string; decimals?: number; symbol?: string };
  steps?: McpDepositStep[];
}

/** `vault_build_request_redeem`: requestRedeem calldata for `owner` (queued vaults: no claim step; the operator finalizes and pays USDC to the receiver). */
export async function buildRedeemRequest(vaultId: string, owner: string, shareUnits: bigint): Promise<McpRedeemPlan> {
  const r = await mcpCall("vault_build_request_redeem", { vaultId, ownerAddress: owner, shareAmount: shareUnits.toString() });
  if (r.isError) throw new Error(`IXS MCP: ${mcpErrorText(r)}`);
  const plan = unwrap<McpRedeemPlan>(r);
  if (!plan?.steps?.length) throw new Error("IXS MCP returned no redeem steps");
  return plan;
}
