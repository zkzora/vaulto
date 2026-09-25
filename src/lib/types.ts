import type { ReplayInfo } from "@/lib/chain/config";

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
  /** "fork" when the RPC is a local Anvil fork of BNB mainnet. */
  rpcKind: "mainnet" | "fork";
  chainId: number;
  blockNumber: number | null;
  /** Native gas token balance (BNB). */
  nativeBalance: number;
  /** Wallet balances keyed by the asset symbol read from the vault's asset() (USDC). */
  balances: Record<string, number>;
  /** Per-chain figures (Live mode needs the balance on the vault's chain). */
  byChain: Record<number, { rpcOk: boolean; rpcKind: "mainnet" | "fork"; blockNumber: number | null; native: number; nativeSymbol: string; balances: Record<string, number>; error?: string }>;
  /** IXS vault share positions, in asset units. */
  positions: { strategyId: string; shares: number; assets: number; chainId: number }[];
  vaults: Record<string, { address: string; tvl: number; sharePrice: number; chainId: number }>;
  /** Symbol of the vault asset as read on-chain. */
  assetSymbol?: string;
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
  /** "simulated" by default; "live" only when the viewer opted in (Settings) and the wallet holds >= LIVE_MODE_MIN_USDC. */
  executionMode: "simulated" | "live";
  /** Chains on which deposits run Live (opt-in on, >= LIVE_MODE_MIN_USDC of the vault asset there). */
  liveChainIds: number[];
  /** Chains on which the wallet could run Live if the viewer opted in. */
  liveCapableChainIds: number[];
  /** Live opt-in for this wallet in this browser (cookie). */
  liveOptIn: boolean;
  /** Replay mode: the vault and wallet state are read at this past block (null = current state). */
  replay?: ReplayInfo | null;
}

export interface VaultStrategy {
  id: string;
  provider: "IXS";
  vaultName: string;
  assetType: string;
  asset: string;
  apy: number | null;
  /** True when the APY is a Vaulto estimate rather than an IXS figure. */
  apyEstimated?: boolean;
  /** Where the yield figure comes from (e.g. trailing 12 months, IXS Vault API). */
  apyNote?: string;
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
  shareDecimals?: number;
  shareSymbol?: string;
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
  /** Vault terms Vaulto enforces and displays (minimum deposit, fees read on-chain, redemption cadence). */
  terms?: VaultTerms;
  apiId?: string;
  subgraphUrl?: string;
  /** maxDeposit() for a new depositor: null = unlimited, 0 = closed. */
  depositLimitUsd?: number | null;
  depositLimitSource?: string;
  nav?: VaultNav;
  /** Median hours from deposit request to processing observed on the IXS subgraph (async vaults). */
  observedSettlementHours?: number | null;
  cutoffNote?: string;
  /** Block number of the last contract read behind these figures. */
  readBlock?: number | null;
  /** Pre-flight result for the analysed wallet (attached during analysis). */
  preflight?: VaultPreflight;
}

export interface CutoffInfoLite {
  nextCutoffUtc: string;
  nextCutoffSgt: string;
  hoursUntilCutoff: number;
  todayCutoffStillOpen: boolean;
  estimatedSettlementUtc: string;
  estimatedSettlementSgt: string;
  skipped: { date: string; reason: string }[];
  holidayAssumption: string;
  source: string;
}

export interface VaultNav {
  pricePerShare: number | null;
  updatedAt: string | null;
  ageHours: number | null;
  block: number | null;
  /** Transaction of the last on-chain NAV change (from the IXS subgraph, verified by receipt). */
  lastChangeTx?: string | null;
  /** navStalenessThreshold() read from the contract, in hours (null when not exposed). */
  contractThresholdHours?: number | null;
  source: string;
  history: { at: string; pricePerShare: number; block: number | null }[];
}

export interface VaultCheck {
  key: string;
  label: string;
  ok: boolean;
  /** block → REJECT when failing, defer → DEFER (waiting NAV refresh) when failing, info → never blocks. */
  severity: "block" | "defer" | "info";
  value: string;
  detail: string;
  source: string;
}

export interface VaultPreflight {
  ok: boolean;
  /** Deterministic hint: allocate (all pass), defer (limit 0 / stale NAV), reject (whitelist, pause, minimum). */
  verdict: "allocate" | "defer" | "reject";
  checkedAt: string;
  wallet: string;
  chainId: number;
  blockNumber: number | null;
  checks: VaultCheck[];
  depositLimitUsd: number | null;
  depositLimitUnlimited: boolean;
  navUpdatedAt: string | null;
  navAgeHours: number | null;
  navLastChangeTx: string | null;
  navLastChangeBlock: number | null;
  minDepositUsd: number;
  settlement: "sync" | "async-erc7540";
  observedSettlementHours: number | null;
  /** Next IXS cutoff and settlement estimate (async vaults only). */
  cutoff: CutoffInfoLite | null;
  redeemPath: string;
  mcpAccepts: boolean | null;
  mcpReason?: string;
  whitelisted: boolean | null;
  /** True when the pre-flight ran for a Live deposit (opt-in on for this chain). */
  live?: boolean;
  /** Replay block the checks were read at (null = current state). */
  replayBlock?: number | null;
  minLiveDepositUsd?: number;
}

export interface VaultTerms {
  minDepositUsd: number;
  depositFeeBps: number;
  redeemFeeBps: number | null;
  redemption: string;
  feeSource: string;
  /** minRedeemAssets() on-chain, in asset units (null when not exposed). */
  minRedeemUsd?: number | null;
  redeemPath?: string;
  /** Live deposit minimum that keeps the position redeemable: ceil(minRedeemAssets / (1 - fee) × 1.03), >= 100 USDC. */
  minLiveDepositUsd?: number;
  minLiveDepositFormula?: string;
  minLiveDepositReason?: string;
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
  chainId: number;
  chainName: string;
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
  verdict?: "reject" | "defer";
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
  /** Who produced the verdicts (SERV or the local fallback) and who wrote the memo/explanation, separately. */
  decisionSource?: "openserv" | "local";
  narrativeSource?: "openserv" | "local";
  reasoningModel?: string;
  durationMs: number;
  createdAt: string;
  txCount: number;
  feeUsd: number;
  idleUsd: number;
  /** Treasury context at creation; used to expire proposals when conditions change. */
  context?: { demoMode: boolean; totalUsd: number; replayBlock?: number | null };
  /** Investment-committee style memo written by SERV reasoning. */
  memo?: Memo;
  /** Exact input handed to SERV reasoning and the raw output it returned. */
  trace?: ReasoningTrace;
  /** Pre-flight results per strategy id at analysis time. */
  preflights?: Record<string, VaultPreflight>;
  /** Vaults deferred ("temporarily paused — waiting NAV refresh"). */
  deferred?: RejectedOption[];
  /** One verdict per candidate vault, as returned by SERV reasoning (or the local engine). */
  decisions?: { strategyId: string; verdict: "allocate" | "defer" | "reject"; amount?: number; reason: string }[];
  /** Next IXS cutoff at analysis time. */
  cutoff?: CutoffInfoLite;
  /** Times the deterministic validator overrode a SERV allocation (0 in a clean run). */
  validatorOverrides?: string[];
  /** Hard limits the deterministic guardrails enforce around SERV's decisions. */
  guardrails?: {
    liquidityFloorPct: number;
    maxAssetExposurePct: number;
    minVaultRiskScore: number;
    minDepositUsd: number;
    maxLiveTxUsdc: number;
    navStaleHours: number;
    liveMode?: "opt-in" | "off";
    liveOptIn?: boolean;
    liveDepositMinimums?: { strategyId: string; vault: string; symbol: string; usd: number; formula: string; reason: string }[];
  };
}

export interface Memo {
  title: string;
  sections: { heading: string; body: string }[];
}

export interface ReasoningTrace {
  source: "openserv" | "local";
  model?: string;
  at: string;
  decision: { input: unknown; output: unknown };
  narrative?: { input: unknown; output: unknown };
}

export interface StepSimulation {
  ok: boolean;
  /** "Simulated on BNB mainnet" or "Mainnet fork". */
  label: string;
  /** Storage overrides applied to the eth_call (balance / allowance). */
  overrides: string[];
  block?: number;
  gasEstimate?: number;
  expectedShares?: number;
  previewShares?: number;
  shareSymbol?: string;
  sharePrice?: number;
  requestId?: string;
  revertReason?: string;
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
  /** Amount in asset base units (from the contract's decimals). */
  units?: string;
  /** eth_call + state override result when the step is simulated. */
  simulation?: StepSimulation;
  note?: string;
  /** Honest label for this step's chain and mode. */
  label?: string;
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
  mode: "onchain" | "simulated";
  executionMode: "simulated" | "live";
  rpcKind: "mainnet" | "fork";
  /** Honest label shown everywhere: "Live · BNB Chain", "Simulated on BNB mainnet" or "Mainnet fork". */
  label: string;
  notes: string[];
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
  label?: string;
  simulation?: StepSimulation;
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
  /** Evidence recorded while serving this request (SERV input/output, IXS MCP calls, on-chain reads). */
  evidence?: { id: string; at: string; kind: string; label: string; chainId?: number; blockNumber?: number | null; request?: unknown; response?: unknown; ok: boolean; durationMs?: number }[];
}
