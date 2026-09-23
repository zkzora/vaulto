import type {
  AgentLog,
  DemoState,
  PreparedTransaction,
  Recommendation,
  RecommendationStatus,
  TransactionRecord,
  TreasuryAsset,
  UserPatch,
  UserProfile,
  VaultStrategy,
} from "@/lib/types";

export interface Store {
  kind: "postgres" | "file";
  getOrCreateUser(address: string): Promise<UserProfile>;
  updateUser(address: string, patch: UserPatch): Promise<UserProfile>;
  getDemoState(address: string): Promise<DemoState>;
  setDemoState(address: string, state: DemoState): Promise<void>;
  saveTreasurySnapshot(address: string, assets: TreasuryAsset[]): Promise<void>;
  upsertStrategies(list: VaultStrategy[]): Promise<void>;
  saveRecommendation(rec: Recommendation): Promise<Recommendation>;
  getLatestRecommendation(address: string): Promise<Recommendation | null>;
  getRecommendation(id: string): Promise<Recommendation | null>;
  updateRecommendationStatus(id: string, status: RecommendationStatus): Promise<Recommendation | null>;
  savePrepared(tx: PreparedTransaction): Promise<void>;
  getPrepared(id: string): Promise<PreparedTransaction | null>;
  saveTransaction(tx: TransactionRecord): Promise<TransactionRecord>;
  listTransactions(address: string, limit?: number): Promise<TransactionRecord[]>;
  addLog(log: Omit<AgentLog, "id" | "createdAt">): Promise<AgentLog>;
  listLogs(address: string, limit?: number): Promise<AgentLog[]>;
  getFaucetClaim(address: string): Promise<string | null>;
  setFaucetClaim(address: string, at: string): Promise<void>;
  resetUser(address: string): Promise<void>;
}

export const normalizeAddress = (a: string) => a.trim().toLowerCase();
