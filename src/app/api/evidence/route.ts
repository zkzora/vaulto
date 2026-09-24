import { readFileSync } from "node:fs";
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

function forkSample(): unknown {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "docs", "fork-demo-sample.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * GET /api/evidence — everything Vaulto's decisions rest on, exportable as JSON:
 * the vault registry with block numbers (limits, NAV timestamps, last NAV change tx), the IXS MCP / API / subgraph
 * calls and responses, on-chain reads, eth_call simulations, SERV reasoning input/output, the mainnet-fork run and
 * the IXS statements Vaulto relies on (dated).
 */
export async function GET() {
  return handle(async () => {
    const registry = await getRegistry();
    return {
      generatedAt: new Date().toISOString(),
      sources: {
        ixsApi: `${env.ixsApiBaseUrl}/vaults`,
        ixsMcp: env.ixsMcpUrl,
        rpcs: { 56: env.rpcUrl, 43114: env.avaxRpcUrl },
        openserv: { model: env.openservModel, mode: env.openservReasoningMode },
      },
      ixsStatements: [
        { date: "2026-09-24", statement: "Daily cutoff 17:00 SGT (09:00 UTC) on Singapore business days (Mon–Fri); requests can be sent anytime and are processed at the next cutoff; settlement ≈ 1 business day. Singapore public holidays: assumed, not confirmed by IXS." },
        { date: "2026-09-24", statement: "A deposit limit of 0 is the NAV-staleness effect between updates, not a closed vault → treat as temporarily paused, waiting NAV refresh (DEFER, not REJECT)." },
        { date: "2026-09-24", statement: "Minimum deposit 100 USDC (official confirmation)." },
        { date: "2026-09-24", statement: "Direct contract builds are allowed for the verified Avalanche proxy 0xaD01573b459805E3954398796203d830B57A8bD9 as a fallback when the MCP fails for a non-safety reason; never when limit / NAV checks fail." },
        { date: "2026-09-24", statement: "Redemption has no claim step: the vault sells the underlying RWA, the operator finalizes and USDC is sent directly to the receiver." },
      ],
      vaults: registry.vaults.map((v) => ({
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
      })),
      registrySource: registry.source,
      cutoff: nextCutoff(),
      watch: watchStatus(),
      forkRun: forkSample(),
      log: listEvidence(),
    };
  });
}
