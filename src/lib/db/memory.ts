import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DEMO_ADDRESS, emptyDemoState } from "@/lib/demo";
import type {
  AgentLog,
  DemoState,
  PreparedTransaction,
  Recommendation,
  RecommendationStatus,
  TransactionRecord,
  TreasuryAsset,
  UserProfile,
  VaultStrategy,
} from "@/lib/types";
import { normalizeAddress, type Store } from "./store";

interface FileData {
  users: Record<string, UserProfile & { demoState: DemoState }>;
  treasury: { address: string; snapshotAt: string; assets: TreasuryAsset[] }[];
  strategies: Record<string, VaultStrategy>;
  recommendations: Recommendation[];
  prepared: Record<string, PreparedTransaction>;
  transactions: TransactionRecord[];
  logs: AgentLog[];
}

const DIR = join(process.cwd(), ".data");
const FILE = join(DIR, "vaulto-store.json");

function load(): FileData {
  try {
    if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, "utf8")) as FileData;
  } catch {
    // corrupt file → start fresh
  }
  return { users: {}, treasury: [], strategies: {}, recommendations: [], prepared: {}, transactions: [], logs: [] };
}

const g = globalThis as unknown as { __vaultoStore?: FileData };

function data(): FileData {
  if (!g.__vaultoStore) g.__vaultoStore = load();
  return g.__vaultoStore;
}

let writeTimer: NodeJS.Timeout | null = null;
function persist() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(FILE, JSON.stringify(data(), null, 1));
    } catch (e) {
      console.warn("[store] persist failed", e);
    }
  }, 150);
}

function defaultUser(address: string): UserProfile & { demoState: DemoState } {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    walletAddress: address,
    daoName: address === DEMO_ADDRESS ? "Acme DAO" : "Treasury",
    treasuryGoal: "Preserve runway, earn on idle capital",
    riskProfile: "Balanced",
    liquidityFloorPct: 30,
    maxAssetExposurePct: 70,
    minVaultRiskScore: 80,
    monthlyBurnUsd: address === DEMO_ADDRESS ? 185_000 : 0,
    // Real wallets start with their real on-chain balances; the demo address shows Acme DAO.
    demoMode: address === DEMO_ADDRESS,
    firstSeenAt: now,
    createdAt: now,
    updatedAt: now,
    demoState: emptyDemoState(),
  };
}

const strip = (u: UserProfile & { demoState: DemoState }): UserProfile => {
  const { demoState: _ignored, ...rest } = u;
  void _ignored;
  return rest;
};

export const fileStore: Store = {
  kind: "file",
  async getOrCreateUser(address) {
    const a = normalizeAddress(address);
    const d = data();
    if (!d.users[a]) {
      d.users[a] = defaultUser(a);
      persist();
    }
    return strip(d.users[a]);
  },
  async updateUser(address, patch) {
    const a = normalizeAddress(address);
    await this.getOrCreateUser(a);
    const d = data();
    d.users[a] = { ...d.users[a], ...patch, updatedAt: new Date().toISOString() };
    persist();
    return strip(d.users[a]);
  },
  async getDemoState(address) {
    await this.getOrCreateUser(address);
    return data().users[normalizeAddress(address)].demoState ?? emptyDemoState();
  },
  async setDemoState(address, state) {
    await this.getOrCreateUser(address);
    data().users[normalizeAddress(address)].demoState = state;
    persist();
  },
  async saveTreasurySnapshot(address, assets) {
    const d = data();
    const a = normalizeAddress(address);
    d.treasury = d.treasury.filter((t) => t.address !== a).slice(-200);
    d.treasury.push({ address: a, snapshotAt: new Date().toISOString(), assets });
    persist();
  },
  async upsertStrategies(list) {
    const d = data();
    for (const s of list) d.strategies[s.id] = s;
    persist();
  },
  async saveRecommendation(rec) {
    const d = data();
    d.recommendations = d.recommendations.filter((r) => r.id !== rec.id);
    d.recommendations.push(rec);
    persist();
    return rec;
  },
  async getLatestRecommendation(address) {
    const a = normalizeAddress(address);
    const list = data().recommendations.filter((r) => r.walletAddress === a);
    return list.length ? list[list.length - 1] : null;
  },
  async getRecommendation(id) {
    return data().recommendations.find((r) => r.id === id) ?? null;
  },
  async updateRecommendationStatus(id, status: RecommendationStatus) {
    const rec = data().recommendations.find((r) => r.id === id);
    if (!rec) return null;
    rec.status = status;
    persist();
    return rec;
  },
  async savePrepared(tx) {
    data().prepared[tx.id] = tx;
    persist();
  },
  async getPrepared(id) {
    return data().prepared[id] ?? null;
  },
  async saveTransaction(tx) {
    const d = data();
    d.transactions = d.transactions.filter((t) => t.id !== tx.id);
    d.transactions.push(tx);
    persist();
    return tx;
  },
  async listTransactions(address, limit = 50) {
    const a = normalizeAddress(address);
    return data()
      .transactions.filter((t) => t.walletAddress === a)
      .slice(-limit)
      .reverse();
  },
  async addLog(log) {
    const entry: AgentLog = { ...log, walletAddress: normalizeAddress(log.walletAddress), id: randomUUID(), createdAt: new Date().toISOString() };
    const d = data();
    d.logs.push(entry);
    if (d.logs.length > 2000) d.logs = d.logs.slice(-2000);
    persist();
    return entry;
  },
  async listLogs(address, limit = 50) {
    const a = normalizeAddress(address);
    return data()
      .logs.filter((l) => l.walletAddress === a)
      .slice(-limit)
      .reverse();
  },
  async resetUser(address) {
    const a = normalizeAddress(address);
    const d = data();
    delete d.users[a];
    d.treasury = d.treasury.filter((t) => t.address !== a);
    d.recommendations = d.recommendations.filter((r) => r.walletAddress !== a);
    d.transactions = d.transactions.filter((t) => t.walletAddress !== a);
    d.logs = d.logs.filter((l) => l.walletAddress !== a);
    persist();
  },
};
