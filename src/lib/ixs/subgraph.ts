import { recordEvidence } from "@/lib/evidence";

/**
 * IXS Goldsky subgraphs (one per vault family and chain). They are the only public source of NAV timestamps,
 * the on-chain minimum deposit and the deposit-request lifecycle (requestedAt → processedAt), so Vaulto reads
 * them for the pre-flight checks and the cutoff / settlement estimates.
 *
 * Families seen on the IXS Vault API:
 *  - "ixs-erc7540-vault-*": Vault { pricePerShare, priceUpdatedAt, minDepositAssets, redeemFeeBps, navStalenessThreshold },
 *    navUpdates, depositRequests { requestedAt, processedAt, status, controller }
 *  - "ixs-managed-vault-*":  vaultStats { pricePerShare, updatedAt, updatedBlock, minDepositAssets, feeBps },
 *    vaultActivities { type: NAV_UPDATED, timestamp, blockNumber }
 */

const TIMEOUT_MS = 8_000;

export interface SubgraphVaultInfo {
  kind: "erc7540" | "managed" | "unknown";
  pricePerShare: bigint | null;
  navUpdatedAt: number | null; // unix seconds
  navUpdatedBlock: number | null;
  minDepositAssets: bigint | null;
  redeemFeeBps: number | null;
  navStalenessThreshold: number | null;
  navHistory: { at: number; pricePerShare: bigint; block: number | null; txHash?: string }[];
  /** Observed deposit-request lifecycle for async vaults (hours from request to processing). */
  settlement: { samples: number; medianHours: number | null; pendingCount: number; lastRequestedAt: number | null };
  raw: unknown;
}

async function gql<T>(url: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }), signal: ctrl.signal, cache: "no-store" });
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
    if (!json.data) throw new Error("empty subgraph response");
    return json.data;
  } finally {
    clearTimeout(t);
  }
}

const big = (v: unknown): bigint | null => (typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : null);
const int = (v: unknown): number | null => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : typeof v === "number" ? v : null);

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const cache = new Map<string, { at: number; value: SubgraphVaultInfo }>();
const TTL_MS = 2 * 60_000;

export async function readSubgraphVault(subgraphUrl: string | undefined, vaultAddress: string, chainId: number): Promise<SubgraphVaultInfo | null> {
  if (!subgraphUrl) return null;
  const key = `${subgraphUrl}#${vaultAddress.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const id = vaultAddress.toLowerCase();
  const started = Date.now();
  try {
    let info: SubgraphVaultInfo;
    if (/erc7540/i.test(subgraphUrl)) {
      const data = await gql<{
        vault: { pricePerShare?: string; priceUpdatedAt?: string; minDepositAssets?: string | null; redeemFeeBps?: string | null; navStalenessThreshold?: string | null } | null;
        navUpdates: { newPricePerShare: string; timestamp: string; blockNumber: string; txHash: string }[];
        depositRequests: { requestedAt: string; processedAt?: string | null; status?: string | null }[];
      }>(
        subgraphUrl,
        `query ($id: ID!, $vault: String!) {
          vault(id: $id) { pricePerShare priceUpdatedAt minDepositAssets redeemFeeBps navStalenessThreshold }
          navUpdates(first: 12, orderBy: timestamp, orderDirection: desc, where: { vault: $vault }) { newPricePerShare timestamp blockNumber txHash }
          depositRequests(first: 100, orderBy: requestedAt, orderDirection: desc, where: { vault: $vault }) { requestedAt processedAt status }
        }`,
        { id, vault: id },
      );
      const lags = data.depositRequests.filter((r) => r.processedAt && Number(r.processedAt) > 0).map((r) => (Number(r.processedAt) - Number(r.requestedAt)) / 3600).filter((h) => h >= 0 && h < 24 * 60);
      const pending = data.depositRequests.filter((r) => !r.processedAt || Number(r.processedAt) === 0).length;
      info = {
        kind: "erc7540",
        pricePerShare: big(data.vault?.pricePerShare),
        navUpdatedAt: int(data.vault?.priceUpdatedAt) ?? int(data.navUpdates[0]?.timestamp),
        navUpdatedBlock: int(data.navUpdates[0]?.blockNumber),
        minDepositAssets: big(data.vault?.minDepositAssets),
        redeemFeeBps: int(data.vault?.redeemFeeBps),
        navStalenessThreshold: int(data.vault?.navStalenessThreshold),
        navHistory: data.navUpdates.map((n) => ({ at: Number(n.timestamp), pricePerShare: BigInt(n.newPricePerShare), block: int(n.blockNumber), txHash: n.txHash })),
        settlement: { samples: lags.length, medianHours: median(lags), pendingCount: pending, lastRequestedAt: int(data.depositRequests[0]?.requestedAt) },
        raw: data,
      };
    } else {
      const data = await gql<{
        vaultStats: { pricePerShare?: string; updatedAt?: string; updatedBlock?: string; minDepositAssets?: string | null; feeBps?: string | null; navStalenessThreshold?: string | null; pendingRedeemCount?: string } | null;
        vaultActivities: { type: string; timestamp: string; blockNumber: string; amount1?: string | null; txHash: string }[];
      }>(
        subgraphUrl,
        `query ($id: ID!, $vault: String!) {
          vaultStats(id: $id) { pricePerShare updatedAt updatedBlock minDepositAssets feeBps navStalenessThreshold pendingRedeemCount }
          vaultActivities(first: 12, orderBy: timestamp, orderDirection: desc, where: { vault: $vault, type: NAV_UPDATED }) { type timestamp blockNumber amount1 txHash }
        }`,
        { id, vault: id },
      );
      const navs = data.vaultActivities.filter((a) => a.type === "NAV_UPDATED");
      info = {
        kind: "managed",
        pricePerShare: big(data.vaultStats?.pricePerShare),
        navUpdatedAt: int(navs[0]?.timestamp) ?? int(data.vaultStats?.updatedAt),
        navUpdatedBlock: int(navs[0]?.blockNumber) ?? int(data.vaultStats?.updatedBlock),
        minDepositAssets: big(data.vaultStats?.minDepositAssets),
        redeemFeeBps: int(data.vaultStats?.feeBps),
        navStalenessThreshold: int(data.vaultStats?.navStalenessThreshold),
        navHistory: navs.map((n) => ({ at: Number(n.timestamp), pricePerShare: big(n.amount1) ?? 0n, block: int(n.blockNumber), txHash: n.txHash })),
        settlement: { samples: 0, medianHours: null, pendingCount: int(data.vaultStats?.pendingRedeemCount) ?? 0, lastRequestedAt: null },
        raw: data,
      };
    }
    cache.set(key, { at: Date.now(), value: info });
    recordEvidence({ kind: "subgraph", label: `IXS subgraph · vault ${vaultAddress.slice(0, 10)}… (${info.kind})`, chainId, blockNumber: info.navUpdatedBlock, request: { subgraphUrl, vault: id }, response: { pricePerShare: info.pricePerShare?.toString(), navUpdatedAt: info.navUpdatedAt, navUpdatedBlock: info.navUpdatedBlock, minDepositAssets: info.minDepositAssets?.toString(), redeemFeeBps: info.redeemFeeBps, navStalenessThreshold: info.navStalenessThreshold, settlement: info.settlement, navHistory: info.navHistory.slice(0, 5).map((n) => ({ at: n.at, pricePerShare: n.pricePerShare.toString(), block: n.block })) }, ok: true, durationMs: Date.now() - started });
    return info;
  } catch (e) {
    recordEvidence({ kind: "subgraph", label: `IXS subgraph · vault ${vaultAddress.slice(0, 10)}…`, chainId, request: { subgraphUrl, vault: id }, response: { error: e instanceof Error ? e.message : String(e) }, ok: false, durationMs: Date.now() - started });
    return hit?.value ?? null;
  }
}

export interface DepositRequestStatus {
  requestId: string;
  assets: string;
  status: string | null;
  requestedAt: number;
  processedAt: number | null;
  requestTxHash?: string;
  finalizeTxHash?: string | null;
}

/** Deposit requests of a wallet on an ERC-7540 vault (the MCP's vault_request_status is currently broken upstream). */
export async function walletDepositRequests(subgraphUrl: string | undefined, vaultAddress: string, wallet: string): Promise<DepositRequestStatus[]> {
  if (!subgraphUrl || !/erc7540/i.test(subgraphUrl)) return [];
  try {
    const data = await gql<{ depositRequests: { requestId: string; assets: string; status?: string | null; requestedAt: string; processedAt?: string | null; requestTxHash?: string; finalizeTxHash?: string | null }[] }>(
      subgraphUrl,
      `query ($vault: String!, $controller: String!) {
        depositRequests(first: 20, orderBy: requestedAt, orderDirection: desc, where: { vault: $vault, controller: $controller }) { requestId assets status requestedAt processedAt requestTxHash finalizeTxHash }
      }`,
      { vault: vaultAddress.toLowerCase(), controller: wallet.toLowerCase() },
    );
    return data.depositRequests.map((r) => ({ requestId: r.requestId, assets: r.assets, status: r.status ?? null, requestedAt: Number(r.requestedAt), processedAt: r.processedAt ? Number(r.processedAt) : null, requestTxHash: r.requestTxHash, finalizeTxHash: r.finalizeTxHash }));
  } catch {
    return [];
  }
}
