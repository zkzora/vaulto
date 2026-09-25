import type { ReplayInfo } from "./chain/config";
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

export interface RedeemSimulation {
  ok: boolean;
  label: string;
  overrides: string[];
  block?: number;
  gasEstimate?: number;
  requestId?: string;
  revertReason?: string;
  shares: number;
  netAssets: number | null;
  grossAssets: number | null;
  feeAssets: number | null;
  path: string;
}

export interface SimulationResponse {
  label: string;
  strategyId: string;
  action?: "deposit" | "redeem";
  amount: number;
  asset: string;
  chainId: number;
  preflight: VaultPreflight | null;
  verdict: "allocate" | "defer" | "reject";
  builtBy: "ixs-mcp" | "local-encoder" | null;
  note?: string;
  settlement?: string;
  mcpDescription?: string;
  minRedeemUsd?: number | null;
  feeBps?: number | null;
  redeem?: RedeemSimulation;
  shares?: number;
  steps: { index: number; kind: string; to: string; data: string; builtBy: string; simulation?: StepSimulation }[];
  evidence?: Omit<EvidenceLogEntry, "origin">[];
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

export interface EvidenceLogEntry {
  id: string;
  at: string;
  kind: string;
  label: string;
  chainId?: number;
  blockNumber?: number | null;
  request?: unknown;
  response?: unknown;
  ok: boolean;
  durationMs?: number;
  /** "instance": recorded by the server instance answering now; "browser": returned to this browser's own requests; "snapshot": from the committed public demo run. */
  origin: "instance" | "browser" | "snapshot";
}

export interface EvidenceSimulation {
  label: string;
  ok: boolean;
  summary: string;
  request?: unknown;
  response?: unknown;
}

/** Committed snapshot of a public demo run (evidence/snapshot-*.json). */
export interface EvidenceSnapshot {
  file?: string;
  capturedAt: string;
  baseUrl: string;
  deployment?: { source?: string; commit?: string | null };
  note?: string;
  replay?: ReplayInfo | null;
  openserv?: { ping?: { ok: boolean; model?: string; error?: string }; model?: string };
  analysis?: {
    wallet: string;
    treasury: string;
    reasoningSource: string;
    decisionSource?: string;
    narrativeSource?: string;
    reasoningModel?: string;
    confidence?: number;
    title?: string;
    headline?: string;
    validatorOverrides?: string[];
    decisions: { strategyId: string; vault?: string; chain?: string; verdict: string; amount?: number; reason: string }[];
    preflights?: Record<string, { verdict: string; blockNumber: number | null; chainId: number; depositLimitUsd: number | null; depositLimitUnlimited: boolean; navUpdatedAt: string | null; navAgeHours: number | null; minDepositUsd?: number; minLiveDepositUsd?: number }>;
    legs?: { vaultName: string; amount: number; asset: string; chainName?: string; amountUsd?: number }[];
    memo?: { title: string; sections: { heading: string; body: string }[] };
    trace?: { decision?: { input: unknown; output: unknown }; narrative?: { input: unknown; output: unknown } };
    guardrails?: Record<string, unknown>;
  };
  simulations?: EvidenceSimulation[];
  logCount?: number;
}

export interface EvidenceResponse {
  generatedAt: string;
  submission: { path: string; label: string; liveExecuted: boolean; note: string };
  deployment: { source: string; commit: string | null; ref: string | null; repo: string | null };
  sources: { ixsApi: string; ixsMcp: string; rpcs: Record<string, string>; openserv: { model: string; mode: string } };
  statements: {
    ixsStated: { date: string; source: string; items: string[] };
    judgesStated: { date: string; source: string; items: string[] };
    vaultoPolicy: string[];
  };
  vaults: Record<string, unknown>[];
  registrySource: string;
  cutoff: CutoffInfoLite;
  watch: WatchStatus;
  snapshot: EvidenceSnapshot | null;
  replaySnapshot: EvidenceSnapshot | null;
  forkRuns: Record<string, unknown>[];
  instanceLogCount: number;
  log: EvidenceLogEntry[];
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
  liveMode: "opt-in" | "off";
  liveOptIn: boolean;
  replay: ReplayInfo | null;
  redeemNavBufferPct: number;
  deployment: { source: "git" | "vercel" | "local"; commit: string | null; ref: string | null; repo: string | null };
  maxLiveTxUsdc: number;
  navStaleHours: number;
  minDepositUsdc: number;
  database: "postgres" | "file";
  chainId: number;
  network: string;
}

export interface ReplayResponse {
  defaultBlock: number;
  active: ReplayInfo | null;
  options: { block: number; label: string; default: boolean }[];
}

export const api = {
  replay: () => request<ReplayResponse>("/api/replay"),
  setReplay: (address: string, block: number | null) =>
    request<{ user: UserProfile; system: SystemInfo }>("/api/settings", { method: "PATCH", body: JSON.stringify({ address, replayBlock: block }) }),
  treasury: (address: string) => request<TreasuryResponse>(`/api/treasury?address=${address}`),
  vaults: () => request<{ strategies: VaultStrategy[]; liveOk: boolean; liveVaults: LiveVault[]; registry: { source: "api" | "fallback"; apiOk: boolean; fetchedAt: string; onchainOk: boolean } }>("/api/vaults"),
  mainnet: () => request<{ vaults: MainnetVault[]; ok: boolean }>("/api/ixs/mainnet"),
  analyze: (address: string) => request<AnalysisResult>("/api/analyze", { method: "POST", body: JSON.stringify({ address }) }),
  recommendation: (address: string) => request<{ recommendation: Recommendation | null }>(`/api/recommendation?address=${address}`),
  setRecommendationStatus: (address: string, id: string, status: RecommendationStatus) =>
    request<{ recommendation: Recommendation | null }>("/api/recommendation", { method: "PATCH", body: JSON.stringify({ address, id, status }) }),
  prepare: (address: string, recommendationId: string, simulate: boolean, recommendation?: Recommendation | null) =>
    request<{ prepared: PreparedTransaction; evidence?: Omit<EvidenceLogEntry, "origin">[] }>("/api/execute", { method: "POST", body: JSON.stringify({ address, recommendationId, simulate, recommendation: recommendation ?? undefined }) }),
  finalize: (address: string, preparedId: string, results: { index: number; hash?: string; status: TxStatus; error?: string }[], extra?: { prepared?: PreparedTransaction; recommendation?: Recommendation | null }) =>
    request<{ transactions: TransactionRecord[]; recommendation: Recommendation | null }>("/api/execute", {
      method: "PUT",
      body: JSON.stringify({ address, preparedId, results, prepared: extra?.prepared, recommendation: extra?.recommendation ?? undefined }),
    }),
  activity: (address: string) => request<{ logs: AgentLog[]; transactions: TransactionRecord[] }>(`/api/activity?address=${address}`),
  risk: (address: string) => request<{ report: RiskReport; snapshot: TreasurySnapshot; recommendation: Recommendation | null }>(`/api/risk?address=${address}`),
  portfolio: (address: string, period: number) =>
    request<{ report: PortfolioReport; snapshot: TreasurySnapshot; strategies: VaultStrategy[] }>(`/api/portfolio?address=${address}&period=${period}`),
  settings: (address: string) => request<{ user: UserProfile; system: SystemInfo }>(`/api/settings?address=${address}`),
  updateSettings: (address: string, patch: UserPatch) =>
    request<{ user: UserProfile; system: SystemInfo }>("/api/settings", { method: "PATCH", body: JSON.stringify({ address, ...patch }) }),
  setLiveOptIn: (address: string, on: boolean) =>
    request<{ user: UserProfile; system: SystemInfo }>("/api/settings", { method: "PATCH", body: JSON.stringify({ address, liveOptIn: on }) }),
  reset: (address: string) => request<{ ok: boolean }>(`/api/settings?address=${address}`, { method: "DELETE" }),
  evidence: () => request<EvidenceResponse>("/api/evidence"),
  simulate: (address: string, strategyId: string, amount?: number, action: "deposit" | "redeem" = "deposit", shares?: number) =>
    request<SimulationResponse>("/api/simulate", { method: "POST", body: JSON.stringify({ address, strategyId, amount, action, shares }) }),
};
