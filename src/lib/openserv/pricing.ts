import { env } from "@/lib/env";
import type { ChatUsage } from "@/lib/openserv/inference";
import type { ServUsage } from "@/lib/types";

/**
 * OpenServ Inference API pricing. GET /v1/models lists every model with `pricing: { input, output, cachedInput }` in
 * US cents per 1M tokens (gpt-5.4-mini: 100 / 600 / 10, i.e. $1.00 input, $6.00 output, $0.10 cached input per 1M).
 * The API exposes no balance endpoint; the remaining credit is shown in the OpenServ console.
 */
interface Pricing {
  modelId: string;
  input: number;
  output: number;
  cachedInput: number;
  source: "OpenServ /v1/models" | "default (gpt-5.4-mini list price)";
}

const DEFAULT: Pricing = { modelId: "gpt-5.4-mini", input: 100, output: 600, cachedInput: 10, source: "default (gpt-5.4-mini list price)" };
const TTL_MS = 6 * 3600_000;
let cache: { at: number; items: Pricing[] } | null = null;

async function loadPricing(): Promise<Pricing[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.items;
  try {
    const res = await fetch(`${env.openservInferenceUrl}/models`, { headers: { authorization: `Bearer ${env.openservApiKey}` }, signal: AbortSignal.timeout(8000), cache: "no-store" });
    const json = (await res.json()) as { items?: { modelId: string; pricing?: { input?: number; output?: number; cachedInput?: number } }[] };
    const items = (json.items ?? [])
      .filter((m) => m.pricing?.input != null && m.pricing?.output != null)
      .map((m) => ({ modelId: m.modelId, input: m.pricing!.input!, output: m.pricing!.output!, cachedInput: m.pricing!.cachedInput ?? m.pricing!.input!, source: "OpenServ /v1/models" as const }));
    if (items.length) cache = { at: Date.now(), items };
    return items.length ? items : [DEFAULT];
  } catch {
    return cache?.items ?? [DEFAULT];
  }
}

/** Pricing for a model id as returned by a completion (e.g. "gpt-5.4-mini-2026-03-17" → "gpt-5.4-mini"). */
async function pricingFor(model: string): Promise<Pricing> {
  const items = await loadPricing();
  const match = items.filter((p) => model === p.modelId || model.startsWith(`${p.modelId}-`)).sort((a, b) => b.modelId.length - a.modelId.length)[0];
  return match ?? (model.startsWith("gpt-5.4-mini") ? DEFAULT : { ...DEFAULT, modelId: model });
}

/** Sum the usage of every attempt of one SERV call and price it. */
export async function priceUsage(model: string, usages: ChatUsage[], attempts: number): Promise<ServUsage> {
  const p = await pricingFor(model);
  const sum = (f: (u: ChatUsage) => number | undefined) => usages.reduce((s, u) => s + (f(u) ?? 0), 0);
  const promptTokens = sum((u) => u.prompt_tokens);
  const cachedTokens = sum((u) => u.prompt_tokens_details?.cached_tokens);
  const completionTokens = sum((u) => u.completion_tokens);
  const reasoningTokens = sum((u) => u.completion_tokens_details?.reasoning_tokens);
  // cents per 1M tokens → USD: tokens × cents / 1e6 / 100
  const costUsd = ((promptTokens - cachedTokens) * p.input + cachedTokens * p.cachedInput + completionTokens * p.output) / 1e8;
  return {
    promptTokens,
    cachedTokens,
    completionTokens,
    reasoningTokens,
    attempts,
    costUsd: Math.round(costUsd * 1e6) / 1e6,
    pricing: `${p.modelId}: input ${p.input}, cached input ${p.cachedInput}, output ${p.output} US cents per 1M tokens (${p.source})`,
  };
}
