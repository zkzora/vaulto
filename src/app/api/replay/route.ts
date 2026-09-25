import { handle } from "@/lib/api-utils";
import { REPLAY_DEFAULT_BLOCK } from "@/lib/chain/config";
import { getRegistry } from "@/lib/ixs/registry";
import { getReplay } from "@/lib/replay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/replay — the replay view of this browser (if any) and the blocks it can pick: the default block
 * (123,779,792, NAV fresh, fork evidence 100 USDC → 91.65 ixv1) and the blocks of recent ixv1 NAV updates.
 */
export async function GET() {
  return handle(async () => {
    const [active, registry] = await Promise.all([getReplay().catch(() => null), getRegistry({ current: true })]);
    const ixv1 = registry.vaults.find((v) => v.chainId === 56 && !v.requiresWhitelist);
    const history = (ixv1?.nav.history ?? []).filter((h) => h.block != null);
    const options = [
      { block: REPLAY_DEFAULT_BLOCK, label: `Block ${REPLAY_DEFAULT_BLOCK} · 24 Sep 2026 15:19 UTC · NAV 38 h old (default; fork evidence 100 USDC → 91.65 ixv1)`, default: true },
      ...history.map((h) => ({ block: (h.block as number) + 20, label: `Block ${(h.block as number) + 20} · ${new Date(h.at * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC · right after a NAV update (${h.pricePerShare.toFixed(6)} USDC/share)`, default: false })),
    ];
    return { defaultBlock: REPLAY_DEFAULT_BLOCK, active, options };
  });
}
