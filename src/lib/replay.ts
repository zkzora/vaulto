import { cookies } from "next/headers";
import { parseAbi, type PublicClient } from "viem";
import { IXS_KNOWN_VAULTS, REPLAY_COOKIE, replayLabel, type ReplayInfo } from "@/lib/chain/config";
import { archiveClient, pinnedClient, publicClient } from "@/lib/chain/client";

/**
 * Replay mode (per browser, cookie `vaulto_replay` = BNB block number). When set, the registry, pre-flight,
 * simulations and wallet reads use the mainnet state at that block through an archive RPC; Live is off and nothing is
 * sent. The default view is the current state.
 */

const navAbi = parseAbi(["function priceUpdatedAt() view returns (uint256)", "function navStalenessThreshold() view returns (uint256)"]);
const IXV1 = IXS_KNOWN_VAULTS[0].address;
const cache = new Map<number, Promise<ReplayInfo>>();

/** Avalanche block at or just before `ts` (binary search on the archive RPC). */
async function avaxBlockAt(ts: number): Promise<{ block: number; timestamp: number }> {
  const c = archiveClient(43114);
  const head = await c.getBlock();
  let hi = head.number;
  let lo = hi > 6_000_000n ? hi - 6_000_000n : 0n;
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    const b = await c.getBlock({ blockNumber: mid });
    if (Number(b.timestamp) <= ts) lo = mid;
    else hi = mid;
  }
  const b = await c.getBlock({ blockNumber: lo });
  return { block: Number(lo), timestamp: Number(b.timestamp) };
}

export function resolveReplay(block: number): Promise<ReplayInfo> {
  let p = cache.get(block);
  if (!p) {
    p = (async () => {
      const bsc = archiveClient(56);
      const b = await bsc.getBlock({ blockNumber: BigInt(block) }).catch((e) => {
        throw new Error(`Replay: block ${block} is not available on the BNB archive RPC (${e instanceof Error ? e.message.split("\n")[0] : "error"})`);
      });
      const ts = Number(b.timestamp);
      const at = pinnedClient(56, BigInt(block));
      const [pu, th] = await Promise.all([
        at.readContract({ address: IXV1, abi: navAbi, functionName: "priceUpdatedAt" }).catch(() => null),
        at.readContract({ address: IXV1, abi: navAbi, functionName: "navStalenessThreshold" }).catch(() => null),
      ]);
      const navAgeHours = pu != null && pu > 0n ? Math.round(((ts - Number(pu)) / 3600) * 10) / 10 : null;
      const navThresholdHours = th != null ? Math.round((Number(th) / 3600) * 10) / 10 : null;
      const navFresh = navAgeHours != null && navThresholdHours != null && navAgeHours >= 0 && navAgeHours <= navThresholdHours;
      const avax = await avaxBlockAt(ts).catch(() => null);
      return { block, timestamp: ts, iso: new Date(ts * 1000).toISOString(), avaxBlock: avax?.block ?? null, avaxTimestamp: avax?.timestamp ?? null, navAgeHours, navThresholdHours, navFresh, label: replayLabel(block, navFresh, navAgeHours) };
    })();
    p.catch(() => cache.delete(block));
    cache.set(block, p);
  }
  return p;
}

/** Replay block requested by this browser, if any. */
export async function replayBlockFromRequest(): Promise<number | null> {
  try {
    const n = Number((await cookies()).get(REPLAY_COOKIE)?.value);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  } catch {
    return null; // outside a request
  }
}

/** Replay context for this request, or null in the default current-state view. Throws if the archive is unavailable. */
export async function getReplay(): Promise<ReplayInfo | null> {
  const n = await replayBlockFromRequest();
  return n ? resolveReplay(n) : null;
}

export interface ChainAt {
  client: PublicClient;
  block: bigint;
  timestamp: number;
}

/** Pinned client + block + time for one chain under a replay context. */
export function chainAt(replay: ReplayInfo, chainId: number): ChainAt {
  const block = chainId === 43114 ? replay.avaxBlock : replay.block;
  const timestamp = chainId === 43114 ? replay.avaxTimestamp : replay.timestamp;
  if (block == null || timestamp == null) throw new Error(`Replay: no ${chainId === 43114 ? "Avalanche" : "BNB"} block available for ${replay.iso}`);
  return { client: pinnedClient(chainId, BigInt(block)), block: BigInt(block), timestamp };
}

/** Client for a chain in the current request: pinned to the replay block, or the regular mainnet client. */
export async function clientForRequest(chainId: number): Promise<{ client: PublicClient; at: ChainAt | null; replay: ReplayInfo | null }> {
  const replay = await getReplay();
  if (!replay) return { client: publicClient(chainId), at: null, replay: null };
  const at = chainAt(replay, chainId);
  return { client: at.client, at, replay };
}

export async function setReplay(block: number | null): Promise<ReplayInfo | null> {
  const jar = await cookies();
  if (block == null) {
    jar.delete(REPLAY_COOKIE);
    return null;
  }
  const info = await resolveReplay(block);
  jar.set(REPLAY_COOKIE, String(block), { path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 7 });
  return info;
}
