import type {
  AgentLog,
  AnalysisResult,
  PortfolioReport,
  PreparedTransaction,
  Recommendation,
  RecommendationStatus,
  CutoffInfoLite,
  RiskReport,
  StepSimulation,
  TransactionRecord,
  TreasurySnapshot,
  TxStatus,
  UserPatch,
  UserProfile,
  VaultPreflight,
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
  chainId: number;
  chainName: string;
  contractAddress: string;
  requiresWhitelist: boolean;
  status: string;
  explorerUrl?: string;
  asset: string;
  strategyId?: string;
}

export interface MainnetVault {
  routeId: string;
  name: string;
  chainId: number;
  chainName: string;
  contractAddress: string;
  asset: string;
  requiresWhitelist: boolean;
  status: string;
  apy: number | null;
  tvlUsd: number | null;
  sharePrice: number | null;
  limitUsd: number | null;
  explorerUrl: string;
  ixsRewards: { active: boolean; multiplier: number } | null;
}

export interface SimulationResponse {
  label: string;
  strategyId: string;
  amount: number;
  asset: string;
  chainId: number;
  preflight: VaultPreflight;
  verdict: "allocate" | "defer" | "reject";
  builtBy: "ixs-mcp" | "local-encoder" | null;
  note?: string;
  steps: { index: number; kind: string; to: string; data: string; builtBy: string; simulation?: StepSimulation }[];
}

export interface WatchEvent {
  id: string;
  at: string;
  routeId: string;
  vault: string;
  chainName: string;
  kind: "limit" | "nav";
  from: string;
  to: string;
  message: string;
}

export interface WatchStatus {
  entries: { routeId: string; vault: string; symbol: string; chainName: string; chainId: number; depositLimitUsd: number | null; depositLimitUnlimited: boolean; navUpdatedAt: number | null; navAgeHours: number | null; pricePerShare: number | null; waitingNavRefresh: boolean; observedAt: string; block: number | null }[];
  events: WatchEvent[];
  waiting: WatchStatus["entries"];
}

export interface EvidenceResponse {
  generatedAt: string;
  sources: { ixsApi: string; ixsMcp: string; rpcs: Record<string, string>; openserv: { model: string; mode: string } };
  ixsStatements: { date: string; statement: string }[];
  vaults: Record<string, unknown>[];
  registrySource: "api" | "fallback";
  cutoff: CutoffInfoLite;
  watch: WatchStatus;
  forkRun: Record<string, unknown> | null;
  forkRunAvalanche: Record<string, unknown> | null;
  log: { id: string; at: string; kind: string; label: string; chainId?: number; blockNumber?: number | null; request?: unknown; response?: unknown; ok: boolean; durationMs?: number }[];
}

export interface TreasuryResponse {
  user: UserProfile;
  snapshot: TreasurySnapshot;
  strategies: VaultStrategy[];
  liveOk: boolean;
  recommendation: Recommendation | null;
  watch: WatchStatus;
  cutoff: CutoffInfoLite;
}

export interface SystemInfo {
  openserv: boolean;
  openservKey: boolean;
  openservWorkspace: boolean;
  openservMode: "inference" | "platform";
  openservModel: string;
  ixsApi: string;
  rpcKind: "mainnet" | "fork";
  rpcUrl: string;
  liveMinUsdc: number;
  minDepositUsdc: number;
  database: "postgres" | "file";
  chainId: number;
  network: string;
}

export const api = {
  treasury: (address: string) => request<TreasuryResponse>(`/api/treasury?address=${address}`),
  vaults: () => request<{ strategies: VaultStrategy[]; liveOk: boolean; liveVaults: LiveVault[]; registry: { source: "api" | "fallback"; apiOk: boolean; fetchedAt: string; onchainOk: boolean } }>("/api/vaults"),
  mainnet: () => request<{ vaults: MainnetVault[]; ok: boolean }>("/api/ixs/mainnet"),
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
  evidence: () => request<EvidenceResponse>("/api/evidence"),
  simulate: (address: string, strategyId: string, amount?: number) =>
    request<SimulationResponse>("/api/simulate", { method: "POST", body: JSON.stringify({ address, strategyId, amount }) }),
};
