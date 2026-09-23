export type RiskProfile = "Conservative" | "Balanced" | "Growth";

export interface UserProfile {
  id: string;
  walletAddress: string;
  daoName: string;
  treasuryGoal: string;
  riskProfile: RiskProfile;
  liquidityFloorPct: number;
  maxAssetExposurePct: number;
  minVaultRiskScore: number;
  monthlyBurnUsd: number;
  demoMode: boolean;
  firstSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export type UserPatch = Partial<
  Pick<
    UserProfile,
    | "daoName"
    | "treasuryGoal"
    | "riskProfile"
    | "liquidityFloorPct"
    | "maxAssetExposurePct"
    | "minVaultRiskScore"
    | "monthlyBurnUsd"
    | "demoMode"
  >
>;

export interface DemoMove {
  strategyId: string;
  asset: string;
  amount: number;
  at: string;
}

export interface DemoState {
  moves: DemoMove[];
}

export interface TreasuryAsset {
  symbol: string;
  name: string;
  balance: number;
  priceUsd: number;
  valueUsd: number;
  allocationPct: number;
  liquidity: "liquid" | "deployed";
  idle: boolean;
  idleAmount: number;
  idleUsd: number;
  deployedAmount: number;
  deployedUsd: number;
  idleDays: number;
  apy: number;
  source: "onchain" | "demo" | "mixed";
  deployedIn?: string;
  note?: string;
  color: string;
  change30dPct: number;
}

export interface VaultPosition {
  strategyId: string;
  vaultName: string;
  asset: string;
  amount: number;
  valueUsd: number;
  apy: number;
  riskScore: number;
  source: "onchain" | "demo";
  shares?: number;
}

export interface OnchainReadout {
  rpcOk: boolean;
  chainId: number;
  blockNumber: number | null;
  /** Native gas token balance (tBNB). */
  nativeBalance: number;
  /** Wallet balances keyed by canonical symbol (ixUSDC = IXS test USDC). */
  balances: Record<string, number>;
  /** IXS vault share positions, in asset units. */
  positions: { strategyId: string; shares: number; assets: number }[];
  vaults: Record<string, { address: string; tvl: number; sharePrice: number }>;
  error?: string;
}

export interface TreasurySnapshot {
  walletAddress: string;
  chainId: number;
  scannedAt: string;
  totalUsd: number;
  idleUsd: number;
  idlePct: number;
  idleDays: number;
  liquidPct: number;
  liquidUsd: number;
  allocatedPct: number;
  allocatedUsd: number;
  blendedApy: number;
  earned30dUsd: number;
  healthScore: number;
  opportunityScore: number;
  opportunityLabel: string;
  runwayMonths: number;
  assets: TreasuryAsset[];
  positions: VaultPosition[];
  onchain: OnchainReadout;
  prices: Record<string, number>;
  demoMode: boolean;
  maxExposure: { symbol: string; pct: number };
  targetAllocationPct: number;
}

export interface VaultStrategy {
  id: string;
  provider: "IXS";
  vaultName: string;
  assetType: string;
  asset: string;
  apy: number | null;
  /** True when the APY is a Vaulto estimate (IXS testnet metrics unavailable). */
  apyEstimated?: boolean;
  /** "announced": IXS has announced the product but no vault is deployed (checked against the IXS Vault API). */
  availability?: "live" | "announced";
  riskScore: number;
  liquidity: string;
  chainId: number;
  network: string;
  chainName: string;
  contractAddress?: string;
  assetAddress?: string;
  assetDecimals?: number;
  settlement: "sync" | "async-erc7540";
  requiresWhitelist: boolean;
  status: string;
  description: string;
  tvlUsd?: number | null;
  sharePrice?: number | null;
  source: "live" | "catalog";
  executable: boolean;
  tag: "primary" | "secondary" | "opportunity" | "live" | "announced";
  routeId?: string;
  explorerUrl?: string;
  capacityNote?: string;
}

export interface AllocationLeg {
  strategyId: string;
  vaultName: string;
  asset: string;
  amount: number;
  amountUsd: number;
  apy: number;
  riskScore: number;
  executable: boolean;
  onchainAmount: number;
}

export interface Metrics {
  liquidPct: number;
  blendedApy: number;
  healthScore: number;
  idlePct: number;
  allocatedPct: number;
  perStrategyPct: Record<string, number>;
}

export interface ReasoningStep {
  agent: string;
  title: string;
  body: string;
}

export interface RejectedOption {
  option: string;
  reason: string;
  tone: "warn" | "muted";
}

export type RecommendationStatus =
  | "proposed"
  | "approved"
  | "executed"
  | "rejected"
  | "dismissed";

export interface Recommendation {
  id: string;
  walletAddress: string;
  title: string;
  headline: string;
  foundLabel: string;
  summary: string;
  legs: AllocationLeg[];
  before: Metrics;
  after: Metrics;
  totalUsd: number;
  extraMonthlyUsd: number;
  confidence: number;
  reasons: { title: string; body: string }[];
  steps: ReasoningStep[];
  rejected: RejectedOption[];
  status: RecommendationStatus;
  reasoningSource: "openserv" | "local";
  reasoningModel?: string;
  durationMs: number;
  createdAt: string;
  txCount: number;
  feeUsd: number;
  idleUsd: number;
  /** Treasury context at creation; used to expire proposals when conditions change. */
  context?: { demoMode: boolean; totalUsd: number };
}

export interface TxStep {
  index: number;
  kind: "approve" | "deposit" | "requestDeposit";
  strategyId: string;
  vaultName: string;
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
  chainId: number;
  description: string;
  amount: number;
  amountUsd: number;
  asset: string;
  mode: "onchain" | "simulated";
  builtBy: "ixs-mcp" | "local-encoder" | "simulation";
  /** Condition to wait for before sending (public RPC nodes can lag behind the previous receipt). */
  precheck?: { kind: "allowance"; token: `0x${string}`; spender: `0x${string}`; amount: string };
}

export interface PreparedTransaction {
  id: string;
  recommendationId: string;
  walletAddress: string;
  steps: TxStep[];
  summary: {
    from: string;
    fromAddress: string;
    destination: string;
    destinationAddress: string;
    action: string;
    amountUsd: number;
    amountLabel: string;
    expectedOutcome: string;
    riskLevel: "Low" | "Medium" | "High";
    riskScores: number[];
    liquidityAfterPct: number;
    liquidityFloorPct: number;
    rail: string;
    feeUsd: number;
  };
  createdAt: string;
  mode: "onchain" | "hybrid" | "simulated";
}

export type TxStatus = "prepared" | "pending" | "confirmed" | "failed" | "simulated";

export interface TransactionRecord {
  id: string;
  walletAddress: string;
  recommendationId?: string;
  hash?: string;
  amountUsd: number;
  status: TxStatus;
  strategy: string;
  description: string;
  chainId: number;
  explorerUrl?: string;
  createdAt: string;
  kind: string;
}

export interface AgentLog {
  id: string;
  walletAddress: string;
  agentName: string;
  action: string;
  reasoning: string;
  status: "info" | "success" | "warn";
  source: "OpenServ" | "IXS" | "Vaulto";
  createdAt: string;
}

export interface RiskItem {
  key: string;
  title: string;
  level: "Low" | "Medium" | "High";
  description: string;
  value: string;
  sub: string;
}

export interface RiskAlert {
  id: string;
  kind: "action" | "info";
  title: string;
  body: string;
  cta?: "review" | "analyze";
}

export interface RiskReport {
  healthScore: number;
  healthLabel: string;
  healthNote: string;
  items: RiskItem[];
  alerts: RiskAlert[];
  checkedAt: string;
  policy: {
    liquidityFloorPct: number;
    maxAssetExposurePct: number;
    minVaultRiskScore: number;
  };
}

export interface PortfolioReport {
  history: { date: string; value: number }[];
  targets: { label: string; actualPct: number; targetPct: number; color: string }[];
  note: string;
  yieldEarnedUsd: number;
  priceChangeUsd: number;
  changeUsd: number;
  changePct: number;
  periodDays: number;
}

export interface AnalysisResult {
  snapshot: TreasurySnapshot;
  recommendation: Recommendation;
  logs: AgentLog[];
  user: UserProfile;
}
