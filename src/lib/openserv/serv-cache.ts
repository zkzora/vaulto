import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ServUsage } from "@/lib/types";

/**
 * SERV output cache, keyed by a hash of the inputs SERV decides on: vault state (on-chain values and the pre-flight
 * outcome per check), treasury balances, policy, guardrails, block (replay block or "current") and the prompt version.
 * Time-derived and price-derived figures (NAV age, idle days, USD totals, next cutoff) are not part of the key, so the
 * cached text quotes them as of the time it was produced; the UI labels it "SERV output (cached from <timestamp>)".
 * Guardrails, the validator and the simulation always run on the current state; only the SERV text is reused.
 *
 * Two tiers: this serverless instance's memory, and seed files committed in evidence/serv-cache/<key>.json (so the
 * canonical demo views hit the cache on a cold instance too). Seeds are written by scripts/serv-cache-seed.mjs.
 */
export interface ServCacheEntry {
  key: string;
  stage: "decision" | "narrative";
  promptVersion: string;
  model: string;
  createdAt: string;
  /** Raw JSON SERV returned (before Vaulto's deterministic post-checks, which are re-applied on reuse). */
  output: unknown;
  usage?: ServUsage;
  view: { address: string; replayBlock: number | null };
}

const SEED_DIR = join(process.cwd(), "evidence", "serv-cache");
const MAX_MEMORY = 300;
const memory = new Map<string, ServCacheEntry>();
let seeds: Map<string, ServCacheEntry> | null = null;

function loadSeeds(): Map<string, ServCacheEntry> {
  if (seeds) return seeds;
  seeds = new Map();
  try {
    for (const f of readdirSync(SEED_DIR).filter((x) => x.endsWith(".json"))) {
      try {
        const e = JSON.parse(readFileSync(join(SEED_DIR, f), "utf8")) as ServCacheEntry;
        if (e?.key && e.output) seeds.set(e.key, e);
      } catch {
        /* skip an unreadable seed */
      }
    }
  } catch {
    /* no seed directory */
  }
  return seeds;
}

/** Canonical JSON (sorted keys, no undefined) → sha256, first 32 hex chars. */
export function stableHash(value: unknown): string {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .sort()
          .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return createHash("sha256").update(JSON.stringify(canon(value))).digest("hex").slice(0, 32);
}

export function cacheGet(key: string): ServCacheEntry | null {
  return memory.get(key) ?? loadSeeds().get(key) ?? null;
}

export function cachePut(entry: ServCacheEntry) {
  memory.delete(entry.key);
  memory.set(entry.key, entry);
  while (memory.size > MAX_MEMORY) memory.delete(memory.keys().next().value!);
}

/** Round to n significant digits (keeps cache keys stable against float noise and tiny price moves in caps). */
export function sig(n: number | null | undefined, digits = 6): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (n === 0) return 0;
  return Number(n.toPrecision(digits));
}
