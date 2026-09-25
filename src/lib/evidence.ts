import { randomUUID } from "node:crypto";

/**
 * Evidence log: every external fact Vaulto relies on (IXS MCP calls and responses, IXS Vault API and subgraph
 * reads, on-chain reads with block numbers, eth_call simulations, SERV reasoning input/output) is recorded here
 * so the /evidence page can show and export it. In-memory ring buffer; the newest 400 entries are kept.
 */

export type EvidenceKind = "mcp" | "ixs-api" | "subgraph" | "onchain" | "simulation" | "serv" | "fork" | "live";

export interface EvidenceEntry {
  id: string;
  at: string;
  kind: EvidenceKind;
  label: string;
  chainId?: number;
  blockNumber?: number | null;
  request?: unknown;
  response?: unknown;
  ok: boolean;
  durationMs?: number;
}

const MAX = 400;
const g = globalThis as unknown as { __vaultoEvidence?: EvidenceEntry[] };
const buffer = (): EvidenceEntry[] => (g.__vaultoEvidence ??= []);

/** Keep JSON small: long strings (calldata, prompts) are trimmed but stay recognisable. */
function trim(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value.length > 4_000 ? `${value.slice(0, 4_000)}… (${value.length} chars)` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => trim(v, depth + 1));
  if (typeof value === "object") {
    if (depth > 6) return "[…]";
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = trim(v, depth + 1);
    return out;
  }
  return value;
}

export function recordEvidence(entry: Omit<EvidenceEntry, "id" | "at">): EvidenceEntry {
  const e: EvidenceEntry = { id: randomUUID(), at: new Date().toISOString(), ...entry, request: trim(entry.request), response: trim(entry.response) };
  const b = buffer();
  b.push(e);
  if (b.length > MAX) b.splice(0, b.length - MAX);
  return e;
}

export function listEvidence(): EvidenceEntry[] {
  return [...buffer()].reverse();
}

/** Wraps an async call so its request, response (or error) and duration land in the evidence log. */
export async function withEvidence<T>(meta: { kind: EvidenceKind; label: string; chainId?: number; request?: unknown; blockNumber?: number | null }, fn: () => Promise<T>, pick?: (r: T) => unknown): Promise<T> {
  const started = Date.now();
  try {
    const r = await fn();
    recordEvidence({ ...meta, ok: true, response: pick ? pick(r) : r, durationMs: Date.now() - started });
    return r;
  } catch (e) {
    recordEvidence({ ...meta, ok: false, response: { error: e instanceof Error ? e.message : String(e) }, durationMs: Date.now() - started });
    throw e;
  }
}
