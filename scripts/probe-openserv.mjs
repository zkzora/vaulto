// Verifies the OpenServ Inference API key (OpenAI-compatible endpoint hosted by OpenServ). Key never printed.
const key = process.env.OPENSERV_API_KEY;
const base = (process.env.OPENSERV_INFERENCE_URL ?? "https://inference-api.openserv.ai/v1").replace(/\/$/, "");
if (!key) { console.log("OPENSERV_API_KEY not set"); process.exit(1); }
const h = { "content-type": "application/json", authorization: `Bearer ${key}` };
try {
  const m = await fetch(`${base}/models`, { headers: h });
  const t = await m.text();
  console.log("GET /models", m.status, t.slice(0, 600).replace(/\s+/g, " "));
} catch (e) { console.log("models ERR", e.message); }
for (const model of [process.env.OPENSERV_MODEL ?? "gpt-5.4-mini"]) {
  const r = await fetch(`${base}/chat/completions`, { method: "POST", headers: h, body: JSON.stringify({ model, messages: [{ role: "system", content: "You are Vaulto." }, { role: "user", content: "Reply with the single word OK." }] }) });
  const t = await r.text();
  console.log("POST /chat/completions", model, r.status, t.slice(0, 500).replace(/\s+/g, " "));
}
