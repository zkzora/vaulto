import { encodeFunctionData, formatUnits, isAddress, parseUnits } from "viem";
import { env } from "@/lib/env";
import { erc20Abi, erc4626Abi } from "@/lib/chain/abi";
import { publicClient } from "@/lib/chain/client";
import { CHAIN_ID } from "@/lib/chain/config";
import { buildCatalog, type IxsVaultItem } from "./catalog";
import type { TxStep, VaultStrategy } from "@/lib/types";

/**
 * IXS adapter layer (BSC Testnet).
 *
 * READ  — vault catalog (REST GET /vaults), on-chain vault state (Multicall3).
 * WRITE — prepare deposit transactions via the IXS MCP (`vault_build_request_deposit`), falling back to
 *         a local ERC-4626 encoder for the Vaulto mirror vaults, which IXS does not index.
 *         Nothing is ever signed or submitted server-side.
 */

const TIMEOUT_MS = 7_000;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`IXS ${res.status} ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

let liveCache: { at: number; items: IxsVaultItem[] } | null = null;

/** IXS vaults on this chain from the IXS Vault API (cached 60s). */
export async function fetchLiveVaults(): Promise<{ items: IxsVaultItem[]; ok: boolean }> {
  if (liveCache && Date.now() - liveCache.at < 60_000) return { items: liveCache.items, ok: true };
  try {
    const json = await fetchJson<{ items: IxsVaultItem[] }>(`${env.ixsApiBaseUrl}/vaults`);
    const items = (json.items ?? []).filter((v) => v.chainId === CHAIN_ID);
    liveCache = { at: Date.now(), items };
    return { items, ok: true };
  } catch {
    return { items: liveCache?.items ?? [], ok: false };
  }
}

/** Enrich every vault in the catalog with live on-chain numbers (two multicalls). */
export async function enrichCatalog(live: IxsVaultItem[]): Promise<VaultStrategy[]> {
  const list = buildCatalog(live);
  const targets = list.filter((s) => s.contractAddress);
  if (!targets.length) return list;
  try {
    const client = publicClient();
    const first = await client.multicall({
      allowFailure: true,
      contracts: targets.flatMap((s) => [
        { address: s.contractAddress as `0x${string}`, abi: erc4626Abi, functionName: "decimals" as const },
        { address: s.contractAddress as `0x${string}`, abi: erc4626Abi, functionName: "totalAssets" as const },
        { address: s.contractAddress as `0x${string}`, abi: erc4626Abi, functionName: "paused" as const },
      ]),
    });
    const decimals = targets.map((_, i) => (first[i * 3]?.status === "success" ? Number(first[i * 3].result) : 18));
    const second = await client.multicall({
      allowFailure: true,
      contracts: targets.map((s, i) => ({ address: s.contractAddress as `0x${string}`, abi: erc4626Abi, functionName: "convertToAssets" as const, args: [10n ** BigInt(decimals[i])] as const })),
    });
    targets.forEach((s, i) => {
      const assetDecimals = s.assetDecimals ?? 6;
      const total = first[i * 3 + 1]?.status === "success" ? (first[i * 3 + 1].result as bigint) : null;
      const paused = first[i * 3 + 2]?.status === "success" ? Boolean(first[i * 3 + 2].result) : false;
      const one = second[i]?.status === "success" ? (second[i].result as bigint) : null;
      if (total != null) s.tvlUsd = s.asset === "BTC" ? null : Number(formatUnits(total, assetDecimals));
      if (one != null) s.sharePrice = Number(formatUnits(one, assetDecimals));
      if (paused) s.status = "paused";
    });
  } catch {
    // keep catalog defaults
  }
  return list;
}

export interface LiveVaultSummary {
  routeId: string;
  name: string;
  symbol: string;
  contractAddress: string;
  requiresWhitelist: boolean;
  status: string;
  explorerUrl?: string;
  asset: string;
  strategyId?: string;
}

export async function getStrategies(): Promise<{ strategies: VaultStrategy[]; liveOk: boolean; liveVaults: LiveVaultSummary[] }> {
  const live = await fetchLiveVaults();
  const strategies = await enrichCatalog(live.items);
  const liveVaults: LiveVaultSummary[] = live.items.map((v) => ({
    routeId: v.routeId,
    name: v.name,
    symbol: v.symbol,
    contractAddress: v.contractAddress,
    requiresWhitelist: v.requiresWhitelist,
    status: v.status,
    explorerUrl: v.explorerUrl,
    asset: v.underlyingAsset?.symbol ?? "USDC",
    strategyId: strategies.find((s) => s.routeId === v.routeId)?.id,
  }));
  return { strategies, liveOk: live.ok, liveVaults };
}

/* ---------------- MCP (JSON-RPC 2.0 over Streamable HTTP) ---------------- */

interface JsonRpcResult<T> {
  result?: T;
  error?: { code: number; message: string };
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

export async function mcpCall<T = unknown>(tool: string, args: Record<string, unknown>): Promise<T> {
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

interface McpToolResult {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

function unwrap<T>(r: McpToolResult): T | null {
  if (r.structuredContent) return r.structuredContent as T;
  const text = r.content?.find((c) => c.type === "text")?.text;
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function mcpErrorText(r: McpToolResult) {
  return r.content?.find((c) => c.type === "text")?.text ?? "IXS MCP error";
}

export async function checkWhitelist(vaultId: string, wallet: string): Promise<boolean | null> {
  try {
    const r = await mcpCall<McpToolResult>("vault_check_whitelist", { vaultId, walletAddress: wallet });
    if (r.isError) return null;
    const data = unwrap<{ whitelisted?: boolean; isWhitelisted?: boolean }>(r);
    return data?.whitelisted ?? data?.isWhitelisted ?? null;
  } catch {
    return null;
  }
}

/** IXS MCP `vault_build_request_deposit` response. */
interface McpDepositPlan {
  ok?: boolean;
  settlement?: "sync" | "async-erc7540";
  steps?: { type: string; description?: string; tx: { to: string; data: string; value?: string } }[];
}

type BuiltStep = Omit<TxStep, "index" | "mode" | "amountUsd">;

/**
 * Prepare an approve + deposit sequence for a strategy.
 * IXS-indexed vaults (routeId) go through the IXS MCP; Vaulto mirror vaults use the local encoder.
 */
export async function buildDepositSteps(strategy: VaultStrategy, owner: string, amount: number): Promise<{ steps: BuiltStep[]; builtBy: "ixs-mcp" | "local-encoder" }> {
  if (!strategy.contractAddress || !strategy.assetAddress) throw new Error("strategy has no contract");
  if (!isAddress(owner)) throw new Error("invalid owner");
  const decimals = strategy.assetDecimals ?? 6;
  const units = parseUnits(amount.toFixed(decimals), decimals);
  const vault = strategy.contractAddress as `0x${string}`;
  const asset = strategy.assetAddress as `0x${string}`;
  const precheck = { kind: "allowance" as const, token: asset, spender: vault, amount: units.toString() };

  if (strategy.routeId) {
    const r = await mcpCall<McpToolResult>("vault_build_request_deposit", { vaultId: strategy.routeId, ownerAddress: owner, assetAmount: units.toString() });
    if (r.isError) throw new Error(`IXS MCP: ${mcpErrorText(r)}`);
    const plan = unwrap<McpDepositPlan>(r);
    if (!plan?.steps?.length) throw new Error("IXS MCP returned no transaction steps");
    return {
      builtBy: "ixs-mcp",
      steps: plan.steps.map((s) => {
        const isApprove = s.type.includes("approve");
        const kind: TxStep["kind"] = isApprove ? "approve" : s.type.includes("request") ? "requestDeposit" : "deposit";
        return {
          kind,
          strategyId: strategy.id,
          vaultName: strategy.vaultName,
          to: s.tx.to as `0x${string}`,
          data: s.tx.data as `0x${string}`,
          value: s.tx.value ?? "0",
          chainId: strategy.chainId,
          description: isApprove ? `Approve ${strategy.asset} for ${strategy.vaultName} (IXS MCP)` : `Deposit ${strategy.asset} into ${strategy.vaultName} (IXS MCP)`,
          amount,
          asset: strategy.asset,
          builtBy: "ixs-mcp" as const,
          ...(isApprove ? {} : { precheck }),
        };
      }),
    };
  }

  // Local ERC-4626 encoder for the Vaulto mirror vaults (same calldata shape the MCP builds for sync vaults).
  const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [vault, units] });
  const deposit =
    strategy.settlement === "sync"
      ? encodeFunctionData({ abi: erc4626Abi, functionName: "deposit", args: [units, owner as `0x${string}`] })
      : encodeFunctionData({ abi: erc4626Abi, functionName: "requestDeposit", args: [units, owner as `0x${string}`, owner as `0x${string}`] });
  return {
    builtBy: "local-encoder",
    steps: [
      { kind: "approve", strategyId: strategy.id, vaultName: strategy.vaultName, to: asset, data: approve, value: "0", chainId: strategy.chainId, description: `Approve ${strategy.asset} for ${strategy.vaultName}`, amount, asset: strategy.asset, builtBy: "local-encoder" },
      {
        kind: strategy.settlement === "sync" ? "deposit" : "requestDeposit",
        strategyId: strategy.id,
        vaultName: strategy.vaultName,
        to: vault,
        data: deposit,
        value: "0",
        chainId: strategy.chainId,
        description: `Deposit ${strategy.asset} into ${strategy.vaultName}`,
        amount,
        asset: strategy.asset,
        builtBy: "local-encoder",
        precheck,
      },
    ],
  };
}
