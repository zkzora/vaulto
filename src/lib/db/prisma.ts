import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { DEMO_ADDRESS, emptyDemoState } from "@/lib/demo";
import type {
  AgentLog,
  DemoState,
  PreparedTransaction,
  Recommendation,
  RiskProfile,
  TransactionRecord,
  UserProfile,
  VaultStrategy,
} from "@/lib/types";
import { normalizeAddress, type Store } from "./store";

const g = globalThis as unknown as { __prisma?: PrismaClient };
const prisma = g.__prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.__prisma = prisma;

type DbUser = Awaited<ReturnType<typeof prisma.user.findUniqueOrThrow>>;

const toProfile = (u: DbUser): UserProfile => ({
  id: u.id,
  walletAddress: u.walletAddress,
  daoName: u.daoName,
  treasuryGoal: u.treasuryGoal,
  riskProfile: u.riskProfile as RiskProfile,
  liquidityFloorPct: u.liquidityFloorPct,
  maxAssetExposurePct: u.maxAssetExposurePct,
  minVaultRiskScore: u.minVaultRiskScore,
  monthlyBurnUsd: u.monthlyBurnUsd,
  demoMode: u.demoMode,
  firstSeenAt: u.firstSeenAt.toISOString(),
  createdAt: u.createdAt.toISOString(),
  updatedAt: u.updatedAt.toISOString(),
});

async function userRow(address: string) {
  const walletAddress = normalizeAddress(address);
  return prisma.user.upsert({ where: { walletAddress }, update: {}, create: { walletAddress, daoName: walletAddress === DEMO_ADDRESS ? "Acme DAO" : "Treasury", demoMode: walletAddress === DEMO_ADDRESS, monthlyBurnUsd: walletAddress === DEMO_ADDRESS ? 185_000 : 0 } });
}

export const prismaStore: Store = {
  kind: "postgres",
  async getOrCreateUser(address) {
    return toProfile(await userRow(address));
  },
  async updateUser(address, patch) {
    await userRow(address);
    return toProfile(await prisma.user.update({ where: { walletAddress: normalizeAddress(address) }, data: patch }));
  },
  async getDemoState(address) {
    const u = await userRow(address);
    return (u.demoState as unknown as DemoState | null) ?? emptyDemoState();
  },
  async setDemoState(address, state) {
    await userRow(address);
    await prisma.user.update({ where: { walletAddress: normalizeAddress(address) }, data: { demoState: JSON.parse(JSON.stringify(state)) } });
  },
  async saveTreasurySnapshot(address, assets) {
    const u = await userRow(address);
    await prisma.$transaction([
      prisma.treasury.deleteMany({ where: { userId: u.id } }),
      prisma.treasury.createMany({
        data: assets.map((a) => ({
          userId: u.id,
          asset: a.symbol,
          balance: a.balance,
          valueUsd: a.valueUsd,
          allocation: a.allocationPct,
          liquidity: a.liquidity,
          idle: a.idle,
          source: a.source,
          deployedIn: a.deployedIn ?? null,
        })),
      }),
    ]);
  },
  async upsertStrategies(list) {
    await prisma.$transaction(
      list.map((s) =>
        prisma.vaultStrategy.upsert({
          where: { id: s.id },
          update: { vaultName: s.vaultName, assetType: s.assetType, apy: s.apy, riskScore: s.riskScore, data: JSON.parse(JSON.stringify(s)) },
          create: { id: s.id, provider: s.provider, vaultName: s.vaultName, assetType: s.assetType, apy: s.apy, riskScore: s.riskScore, data: JSON.parse(JSON.stringify(s)) },
        }),
      ),
    );
  },
  async saveRecommendation(rec) {
    const u = await userRow(rec.walletAddress);
    await prisma.recommendation.upsert({
      where: { id: rec.id },
      update: { status: rec.status, data: JSON.parse(JSON.stringify(rec)) },
      create: {
        id: rec.id,
        userId: u.id,
        strategy: rec.legs.map((l) => l.vaultName).join(" + "),
        reasoning: rec.summary,
        status: rec.status,
        data: JSON.parse(JSON.stringify(rec)),
      },
    });
    return rec;
  },
  async getLatestRecommendation(address) {
    const u = await userRow(address);
    const row = await prisma.recommendation.findFirst({ where: { userId: u.id }, orderBy: { createdAt: "desc" } });
    return row ? ({ ...(row.data as unknown as Recommendation), status: row.status as Recommendation["status"] }) : null;
  },
  async getRecommendation(id) {
    const row = await prisma.recommendation.findUnique({ where: { id } });
    return row ? ({ ...(row.data as unknown as Recommendation), status: row.status as Recommendation["status"] }) : null;
  },
  async updateRecommendationStatus(id, status) {
    const row = await prisma.recommendation.findUnique({ where: { id } });
    if (!row) return null;
    const rec = { ...(row.data as unknown as Recommendation), status };
    await prisma.recommendation.update({ where: { id }, data: { status, data: JSON.parse(JSON.stringify(rec)) } });
    return rec;
  },
  async savePrepared(tx) {
    const u = await userRow(tx.walletAddress);
    await prisma.transaction.create({
      data: { id: tx.id, userId: u.id, recommendationId: tx.recommendationId, amount: tx.summary.amountUsd, status: "prepared", data: JSON.parse(JSON.stringify({ prepared: tx })) },
    });
  },
  async getPrepared(id) {
    const row = await prisma.transaction.findUnique({ where: { id } });
    const d = row?.data as { prepared?: PreparedTransaction } | undefined;
    return d?.prepared ?? null;
  },
  async saveTransaction(tx) {
    const u = await userRow(tx.walletAddress);
    await prisma.transaction.upsert({
      where: { id: tx.id },
      update: { hash: tx.hash ?? null, status: tx.status, data: JSON.parse(JSON.stringify(tx)) },
      create: { id: tx.id, userId: u.id, recommendationId: tx.recommendationId ?? null, hash: tx.hash ?? null, amount: tx.amountUsd, status: tx.status, data: JSON.parse(JSON.stringify(tx)) },
    });
    return tx;
  },
  async listTransactions(address, limit = 50) {
    const u = await userRow(address);
    const rows = await prisma.transaction.findMany({ where: { userId: u.id, NOT: { status: "prepared" } }, orderBy: { createdAt: "desc" }, take: limit });
    return rows.map((r) => r.data as unknown as TransactionRecord);
  },
  async addLog(log) {
    const u = await userRow(log.walletAddress);
    const row = await prisma.agentLog.create({
      data: { id: randomUUID(), userId: u.id, agentName: log.agentName, action: log.action, reasoning: log.reasoning, status: log.status, source: log.source },
    });
    return { ...log, id: row.id, createdAt: row.createdAt.toISOString() } as AgentLog;
  },
  async listLogs(address, limit = 50) {
    const u = await userRow(address);
    const rows = await prisma.agentLog.findMany({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, take: limit });
    return rows.map((r) => ({
      id: r.id,
      walletAddress: u.walletAddress,
      agentName: r.agentName,
      action: r.action,
      reasoning: r.reasoning,
      status: r.status as AgentLog["status"],
      source: r.source as AgentLog["source"],
      createdAt: r.createdAt.toISOString(),
    }));
  },
  async getFaucetClaim(address) {
    const u = await userRow(address);
    return u.lastFaucetAt ? u.lastFaucetAt.toISOString() : null;
  },
  async setFaucetClaim(address, at) {
    await userRow(address);
    await prisma.user.update({ where: { walletAddress: normalizeAddress(address) }, data: { lastFaucetAt: new Date(at) } });
  },
  async resetUser(address) {
    await prisma.user.deleteMany({ where: { walletAddress: normalizeAddress(address) } });
  },
};

export type { VaultStrategy };
