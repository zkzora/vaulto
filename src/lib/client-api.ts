import type {
  AgentLog,
  AnalysisResult,
  PortfolioReport,
  PreparedTransaction,
  Recommendation,
  RecommendationStatus,
  RiskReport,
  TransactionRecord,
  TreasurySnapshot,
  TxStatus,
  UserPatch,
  UserProfile,
  VaultStrategy,
} from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

export interface LiveVault {
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

export interface TreasuryResponse {
  user: UserProfile;
  snapshot: TreasurySnapshot;
  strategies: VaultStrategy[];
  liveOk: boolean;
  recommendation: Recommendation | null;
}

export interface SystemInfo {
  openserv: boolean;
  openservKey: boolean;
  openservWorkspace: boolean;
  openservMode: "inference" | "platform";
  openservModel: string;
  faucet: boolean;
  database: "postgres" | "file";
  chainId: number;
  network: string;
}

export const api = {
  treasury: (address: string) => request<TreasuryResponse>(`/api/treasury?address=${address}`),
  vaults: () => request<{ strategies: VaultStrategy[]; liveOk: boolean; liveVaults: LiveVault[] }>("/api/vaults"),
  analyze: (address: string) => request<AnalysisResult>("/api/analyze", { method: "POST", body: JSON.stringify({ address }) }),
  recommendation: (address: string) => request<{ recommendation: Recommendation | null }>(`/api/recommendation?address=${address}`),
  setRecommendationStatus: (address: string, id: string, status: RecommendationStatus) =>
    request<{ recommendation: Recommendation | null }>("/api/recommendation", { method: "PATCH", body: JSON.stringify({ address, id, status }) }),
  prepare: (address: string, recommendationId: string, simulate: boolean) =>
    request<{ prepared: PreparedTransaction }>("/api/execute", { method: "POST", body: JSON.stringify({ address, recommendationId, simulate }) }),
  finalize: (address: string, preparedId: string, results: { index: number; hash?: string; status: TxStatus; error?: string }[]) =>
    request<{ transactions: TransactionRecord[]; recommendation: Recommendation | null }>("/api/execute", {
      method: "PUT",
      body: JSON.stringify({ address, preparedId, results }),
    }),
  activity: (address: string) => request<{ logs: AgentLog[]; transactions: TransactionRecord[] }>(`/api/activity?address=${address}`),
  risk: (address: string) => request<{ report: RiskReport; snapshot: TreasurySnapshot; recommendation: Recommendation | null }>(`/api/risk?address=${address}`),
  portfolio: (address: string, period: number) =>
    request<{ report: PortfolioReport; snapshot: TreasurySnapshot; strategies: VaultStrategy[] }>(`/api/portfolio?address=${address}&period=${period}`),
  settings: (address: string) => request<{ user: UserProfile; system: SystemInfo }>(`/api/settings?address=${address}`),
  updateSettings: (address: string, patch: UserPatch) =>
    request<{ user: UserProfile; system: SystemInfo }>("/api/settings", { method: "PATCH", body: JSON.stringify({ address, ...patch }) }),
  reset: (address: string) => request<{ ok: boolean }>(`/api/settings?address=${address}`, { method: "DELETE" }),
};
