import { env } from "@/lib/env";

/**
 * OpenServ Inference API — OpenAI-compatible chat completions hosted by OpenServ
 * (https://inference-api.openserv.ai/v1), authenticated with the OpenServ `serv_…` API key.
 * This is the primary reasoning backend for Vaulto; no OpenAI account is involved.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export async function chatCompletion(params: { messages: ChatMessage[]; model?: string; temperature?: number; timeoutMs?: number; maxTokens?: number }): Promise<ChatResult> {
  if (!env.openservApiKey) throw new Error("OPENSERV_API_KEY not set");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), params.timeoutMs ?? env.openservTimeoutMs);
  try {
    const res = await fetch(`${env.openservInferenceUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.openservApiKey}` },
      body: JSON.stringify({
        model: params.model ?? env.openservModel,
        messages: params.messages,
        temperature: params.temperature ?? 0.2,
        // The gateway derives a default max_tokens from the context window and can exceed the model limit; be explicit.
        max_tokens: params.maxTokens ?? 4096,
      }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`OpenServ inference ${res.status}: ${text.slice(0, 200)}`);
    const json = JSON.parse(text) as { model?: string; choices?: { message?: { content?: string } }[]; usage?: ChatResult["usage"] };
    const content = json.choices?.[0]?.message?.content ?? "";
    if (!content) throw new Error("OpenServ inference returned no content");
    return { content, model: json.model ?? params.model ?? env.openservModel, usage: json.usage };
  } finally {
    clearTimeout(t);
  }
}

export async function checkInference(): Promise<{ ok: boolean; model?: string; error?: string }> {
  try {
    const r = await chatCompletion({ messages: [{ role: "system", content: "You are a health check. Reply with the single word OK." }, { role: "user", content: "Reply with OK." }], timeoutMs: 15_000, maxTokens: 8 });
    return { ok: true, model: r.model };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
