/**
 * Vaulto Agent for the OpenServ platform.
 *
 * Registers the six Vaulto agents as OpenServ capabilities and connects to the platform through
 * the SDK tunnel, so the OpenServ runtime can dispatch tasks to it (no public URL, no OpenAI key).
 * The Vaulto web app creates reasoning tasks in the workspace; the runtime executes them with its
 * own model and these capabilities, then completes the task with the explanation.
 *
 *   OPENSERV_API_KEY=…  VAULTO_API_URL=http://localhost:3000  npm run agent
 *
 * Setup on platform.openserv.ai: Developer → Add agent (name "Vaulto") → copy its API key into
 * .env → create a workspace, add the Vaulto agent → put the workspace id in OPENSERV_WORKSPACE_ID.
 */
import { Agent, run } from "@openserv-labs/sdk";
import { z } from "zod";

const API = (process.env.VAULTO_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

async function call(path, init) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `Vaulto API ${res.status}`);
  return json;
}

const agent = new Agent({
  systemPrompt: `You are Vaulto, an AI treasury allocation agent. You find idle treasury capital, reason about IXS RWA vault strategies and prepare approved allocations. You never execute financial actions without explicit user approval; every transaction is signed by the user's wallet. When a task body contains PIPELINE FACTS, write the explanation strictly from those facts and reply with the requested JSON only.`,
  port: Number(process.env.OPENSERV_AGENT_PORT ?? 7378),
});

const address = z.string().describe("Treasury wallet address (0x…)");

agent.addCapability({
  name: "scan_treasury",
  description: "Treasury Scanner Agent: read wallet balances and IXS positions, detect idle capital and compute treasury efficiency.",
  inputSchema: z.object({ walletAddress: address }),
  async run({ args }) {
    const { snapshot } = await call(`/api/treasury?address=${args.walletAddress}`);
    return JSON.stringify({
      totalUsd: snapshot.totalUsd,
      idleUsd: snapshot.idleUsd,
      idlePct: snapshot.idlePct,
      idleDays: snapshot.idleDays,
      healthScore: snapshot.healthScore,
      opportunityScore: snapshot.opportunityScore,
      assets: snapshot.assets.map((a) => ({ symbol: a.symbol, valueUsd: a.valueUsd, idleAmount: a.idleAmount, deployedIn: a.deployedIn })),
      positions: snapshot.positions,
    });
  },
});

agent.addCapability({
  name: "list_ixs_strategies",
  description: "Opportunity Finder Agent: list IXS RWA vault strategies with yield, risk score, liquidity and eligibility.",
  inputSchema: z.object({}),
  async run() {
    const { strategies } = await call(`/api/vaults`);
    return JSON.stringify(strategies.map((s) => ({ id: s.id, vault: s.vaultName, asset: s.asset, apy: s.apy, riskScore: s.riskScore, liquidity: s.liquidity, chain: s.chainName, requiresWhitelist: s.requiresWhitelist, executable: s.executable })));
  },
});

agent.addCapability({
  name: "analyze_treasury",
  description: "Run the full Vaulto pipeline (Scanner → Finder → Risk Guardian → Allocation Planner) and return the allocation recommendation.",
  inputSchema: z.object({ walletAddress: address }),
  async run({ args }) {
    const { recommendation } = await call(`/api/analyze`, { method: "POST", body: JSON.stringify({ address: args.walletAddress }) });
    return JSON.stringify(recommendation);
  },
});

agent.addCapability({
  name: "get_recommendation",
  description: "Return the latest allocation recommendation for a treasury wallet.",
  inputSchema: z.object({ walletAddress: address }),
  async run({ args }) {
    const { recommendation } = await call(`/api/recommendation?address=${args.walletAddress}`);
    return JSON.stringify(recommendation ?? { message: "No recommendation yet. Run analyze_treasury." });
  },
});

agent.addCapability({
  name: "prepare_execution",
  description: "Execution Agent: prepare the approved allocation as unsigned IXS vault transactions (approve + deposit). Nothing is signed or sent.",
  inputSchema: z.object({ walletAddress: address, recommendationId: z.string(), simulate: z.boolean().optional() }),
  async run({ args }) {
    const { prepared } = await call(`/api/execute`, { method: "POST", body: JSON.stringify({ address: args.walletAddress, recommendationId: args.recommendationId, simulate: args.simulate ?? false }) });
    return JSON.stringify({ id: prepared.id, mode: prepared.mode, summary: prepared.summary, steps: prepared.steps.map((s) => ({ kind: s.kind, vault: s.vaultName, to: s.to, mode: s.mode, description: s.description })) });
  },
});

agent.addCapability({
  name: "get_activity",
  description: "Monitoring Agent: return recent agent logs and transactions for a treasury wallet.",
  inputSchema: z.object({ walletAddress: address }),
  async run({ args }) {
    const { logs, transactions } = await call(`/api/activity?address=${args.walletAddress}`);
    return JSON.stringify({ logs: logs.slice(0, 20), transactions: transactions.slice(0, 20) });
  },
});

if (process.env.DISABLE_TUNNEL === "true") {
  await agent.start();
  console.log(`Vaulto OpenServ agent listening on :${agent.port} (no tunnel) → ${API}`);
} else {
  await run(agent);
  console.log(`Vaulto OpenServ agent connected to the OpenServ platform via tunnel → ${API}`);
}
