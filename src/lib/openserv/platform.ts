import { env } from "@/lib/env";

/**
 * Thin client for the OpenServ platform API (same endpoints the OpenServ SDK uses).
 *
 * Reasoning flow: Vaulto creates a task in the OpenServ workspace assigned to the Vaulto agent.
 * The OpenServ runtime executes the task with its own model (billed to the workspace) and the
 * agent's capabilities, then marks it done with the output. Vaulto polls the task until it
 * completes. No OpenAI key is involved anywhere.
 */

const headers = () => ({ "content-type": "application/json", "x-openserv-key": env.openservApiKey });

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${env.openservApiUrl}${path}`, { ...init, headers: { ...headers(), ...(init?.headers ?? {}) }, cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`OpenServ ${res.status} ${path}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

interface AgentRow {
  id: number;
  name: string;
  capabilitiesDescription: string;
}

interface TaskDetail {
  id: number;
  status: "to-do" | "in-progress" | "human-assistance-required" | "error" | "done" | "cancelled";
  output?: string | null;
  description: string;
}

let agentCache: { at: number; id: number } | null = null;

export async function resolveAgentId(): Promise<number> {
  if (env.openservAgentId) return Number(env.openservAgentId);
  if (agentCache && Date.now() - agentCache.at < 10 * 60_000) return agentCache.id;
  const agents = await api<AgentRow[]>(`/workspaces/${env.openservWorkspaceId}/agents`);
  const match = agents.find((a) => a.name.toLowerCase().includes(env.openservAgentName.toLowerCase())) ?? agents[0];
  if (!match) throw new Error("No agent found in the OpenServ workspace. Add the Vaulto agent to the workspace first.");
  agentCache = { at: Date.now(), id: match.id };
  return match.id;
}

export async function createTask(params: { description: string; body: string; expectedOutput: string }): Promise<number> {
  const assignee = await resolveAgentId();
  const res = await api<{ id: number }>(`/workspaces/${env.openservWorkspaceId}/task`, {
    method: "POST",
    body: JSON.stringify({ assignee, description: params.description, body: params.body, input: "", expectedOutput: params.expectedOutput, dependencies: [] }),
  });
  return res.id;
}

export async function getTask(taskId: number): Promise<TaskDetail> {
  return api<TaskDetail>(`/workspaces/${env.openservWorkspaceId}/tasks/${taskId}/detail`);
}

/** Creates a task for the Vaulto agent and waits for the OpenServ runtime to complete it. */
export async function runOpenServTask(params: { description: string; body: string; expectedOutput: string }, timeoutMs = env.openservTimeoutMs): Promise<{ taskId: number; output: string }> {
  const taskId = await createTask(params);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2_500));
    const t = await getTask(taskId);
    if (t.status === "done") {
      if (!t.output) throw new Error(`OpenServ task ${taskId} finished without output`);
      return { taskId, output: t.output };
    }
    if (t.status === "error" || t.status === "cancelled" || t.status === "human-assistance-required") {
      throw new Error(`OpenServ task ${taskId} ended with status ${t.status}`);
    }
  }
  throw new Error(`OpenServ task ${taskId} timed out after ${Math.round(timeoutMs / 1000)}s`);
}

export async function checkPlatform(): Promise<{ ok: boolean; agents?: string[]; error?: string }> {
  try {
    const agents = await api<AgentRow[]>(`/workspaces/${env.openservWorkspaceId}/agents`);
    return { ok: true, agents: agents.map((a) => a.name) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
