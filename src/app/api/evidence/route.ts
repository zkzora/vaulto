import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { handle } from "@/lib/api-utils";
import { chainInfo } from "@/lib/chain/config";
import { env } from "@/lib/env";
import { listEvidence } from "@/lib/evidence";
import { nextCutoff } from "@/lib/ixs/cutoff";
import { getRegistry } from "@/lib/ixs/registry";
import { watchStatus } from "@/lib/ixs/watch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EVIDENCE_DIR = join(process.cwd(), "evidence");

function readEvidenceFile(file: string): Record<string, unknown> | null {
  try {
    return { ...JSON.parse(readFileSync(join(EVIDENCE_DIR, file), "utf8")), file: `evidence/${file}` };
  } catch {
    return null;
  }
}

function evidenceFiles(prefix: string): string[] {
  try {
    return readdirSync(EVIDENCE_DIR).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

/** Newest committed snapshot of a public demo run (evidence/snapshot-*.json, or evidence/replay-*.json for Replay). */
function latestSnapshot(prefix = "snapshot-"): Record<string, unknown> | null {
  const files = evidenceFiles(prefix);
  return files.length ? readEvidenceFile(files[files.length - 1]) : null;
}

/** Mainnet-fork runs of scripts/fork-demo.mjs (evidence/fork-*.json), BNB first, newest block first. */
function forkRuns(): Record<string, unknown>[] {
  return evidenceFiles("fork-")
    .map(readEvidenceFile)
    .filter((r): r is Record<string, unknown> => r != null)
    .sort((a, b) => Number(a.chainId) - Number(b.chainId) || Number(b.forkBlock) - Number(a.forkBlock));
}

/**
 * What others stated (quoted facts only) is kept apart from Vaulto's own policy (our interpretation of those facts).
 */
const STATEMENTS = {
  ixsStated: {
    date: "2026-09-24",
    source: "IXS, reply in the public OpenServ Telegram",
    items: [
      "Cutoff 17:00 SGT on Singapore business days (Mon–Fri); requests can be sent at any time and are processed at the next cutoff.",
      "Building directly against the vault contract, without the IXS API or MCP, is allowed.",
      "Minimum deposit: 100 USDC.",
      "A deposit limit of 0 relates to NAV staleness (NAV drift between updates).",
      "Redemption has no claim step: the operator sends USDC directly to the receiver.",
    ],
  },
  judgesStated: {
    date: "2026-09-24",
    source: "Hackathon judges",
    items: ["\"Mainnet is preferable but simulated is acceptable.\""],
  },
  vaultoPolicy: [
    "A deposit limit of 0 or a stale NAV → DEFER (temporarily paused, waiting NAV refresh), not REJECT.",
    "Direct contract builds only as a fallback when the IXS MCP fails for a non-safety reason, and never when the deposit-limit or NAV checks fail. In Replay (a past block, simulation only) calldata is encoded directly because the MCP builds against the current state only.",
    "No mock tokens or mock vaults: only the vaults listed by the IXS Vault API and the asset their contracts report through asset().",
    "Live deposits into ixv1 need at least 104 USDC = ceil(100 / 0.995 × 1.03), so the position stays redeemable above the 100 USDC net minimum (minRedeemAssets) after the 0.5% fee (feeBps) with a 3% NAV buffer.",
    "Settlement of async requests is estimated at about one business day after the cutoff, and Singapore public holidays come from the public calendar: both are Vaulto assumptions, not IXS statements.",
    "A NAV older than 72 h, or older than the contract's navStalenessThreshold(), is treated as stale.",
  ],
};

const SUBMISSION = {
  path: "simulated",
  label: "Simulated on BNB mainnet",
  liveExecuted: false,
  note: "Every deposit in this submission runs as eth_call + state override against the real IXS vaults (or on an Anvil mainnet fork). Live mode is a ready capability (opt-in per wallet, wallet-signed, exact-amount approvals, hard cap per transaction, Live minimum 104 USDC into ixv1) and was not executed in this submission.",
};

/**
 * GET /api/evidence — everything Vaulto's decisions rest on, exportable as JSON: the vault registry with block numbers,
 * the committed snapshot of the latest public demo run (pre-flight per vault, SERV input/output, simulations), the
 * mainnet-fork runs, the dated IXS and judge statements, and the call log of this server instance on top of the
 * snapshot's call log, so the page is never empty on a fresh serverless instance.
 */
export async function GET() {
  return handle(async () => {
    const snapshot = latestSnapshot("snapshot-");
    const replaySnapshot = latestSnapshot("replay-");
    let vaults: Record<string, unknown>[] = [];
    let registrySource: string = "snapshot";
    try {
      // The vault table always shows today's state, whatever view this browser is in.
      const registry = await getRegistry({ current: true });
      registrySource = registry.source;
      vaults = registry.vaults.map((v) => ({
        chainId: v.chainId,
        chain: v.chainName,
        apiId: v.apiId,
        routeId: v.routeId,
        address: v.address,
        explorer: v.explorerUrl,
        symbol: v.symbol,
        settlement: v.settlement,
        settlementSource: v.settlementSource,
        requiresWhitelist: v.requiresWhitelist,
        whitelistEnabled: v.whitelistEnabled,
        paused: v.paused,
        asset: v.asset,
        shareDecimals: v.shareDecimals,
        redeemFeeBps: v.redeemFeeBps,
        redeem: v.redeem,
        totalAssets: v.totalAssets,
        totalSupply: v.totalSupply,
        pricePerShare: v.sharePrice,
        readBlock: v.blockNumber,
        readAt: v.readAt,
        depositLimit: v.depositLimit,
        minDeposit: v.minDeposit,
        nav: { ...v.nav, updatedAtIso: v.nav.updatedAt ? new Date(v.nav.updatedAt * 1000).toISOString() : null, lastChangeExplorer: v.nav.lastChangeTx ? `${chainInfo(v.chainId).explorer}/tx/${v.nav.lastChangeTx}` : null },
        settlementObserved: v.settlementObserved,
        cutoff: v.cutoff,
        subgraphUrl: v.subgraphUrl,
      }));
    } catch {
      vaults = ((snapshot?.registry as { vaults?: Record<string, unknown>[] } | undefined)?.vaults ?? []) as Record<string, unknown>[];
    }
    const instanceLog = listEvidence().map((e) => ({ ...e, origin: "instance" as const }));
    const snapshotLog = [...(((snapshot?.log as unknown[]) ?? []) as Record<string, unknown>[]), ...(((replaySnapshot?.log as unknown[]) ?? []) as Record<string, unknown>[])].map((e) => ({ ...e, origin: "snapshot" as const }));
    return {
      generatedAt: new Date().toISOString(),
      submission: SUBMISSION,
      deployment: {
        source: process.env.VERCEL_GIT_COMMIT_SHA ? "git" : process.env.VERCEL ? "vercel" : "local",
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
        ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
        repo: process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}` : null,
      },
      sources: {
        ixsApi: `${env.ixsApiBaseUrl}/vaults`,
        ixsMcp: env.ixsMcpUrl,
        rpcs: { 56: env.rpcUrl, 43114: env.avaxRpcUrl },
        openserv: { model: env.openservModel, mode: env.openservReasoningMode },
      },
      statements: STATEMENTS,
      vaults,
      registrySource,
      cutoff: nextCutoff(),
      watch: watchStatus(),
      snapshot: snapshot ? { ...snapshot, log: undefined, logCount: ((snapshot.log as unknown[]) ?? []).length } : null,
      replaySnapshot: replaySnapshot ? { ...replaySnapshot, log: undefined, logCount: ((replaySnapshot.log as unknown[]) ?? []).length } : null,
      forkRuns: forkRuns(),
      instanceLogCount: instanceLog.length,
      log: [...instanceLog, ...snapshotLog],
    };
  });
}
