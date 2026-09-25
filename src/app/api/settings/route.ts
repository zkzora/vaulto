import { z } from "zod";
import { addressFrom, addressSchema, bad, handle } from "@/lib/api-utils";
import { CHAIN_ID, CHAIN_NAME, LIVE_MODE_MIN_USDC, MIN_DEPOSIT_USDC, REDEEM_NAV_BUFFER_PCT, redeemableMinimum } from "@/lib/chain/config";
import { getRegistry } from "@/lib/ixs/registry";
import { RPC_KIND } from "@/lib/chain/client";
import { env, openservConfigured } from "@/lib/env";
import { liveOptedIn, setLiveOptIn } from "@/lib/live-optin";
import { checkInference } from "@/lib/openserv/inference";
import { getStore } from "@/lib/db";
import { getUser, resetUser, updateUser } from "@/lib/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function systemInfo(liveOptIn: boolean) {
  const store = await getStore();
  const registry = await getRegistry().catch(() => null);
  const liveDepositMinimums = (registry?.vaults ?? []).map((v) => ({ vault: v.symbol, chainId: v.chainId, ...redeemableMinimum(v.redeem.minAssetsUsd, v.redeem.feeBps, v.asset.symbol) })).map(({ vault, chainId, usd, formula }) => ({ vault, chainId, usd, formula }));
  return {
    openserv: openservConfigured(),
    openservKey: Boolean(env.openservApiKey),
    openservWorkspace: Boolean(env.openservWorkspaceId),
    openservMode: env.openservReasoningMode,
    openservModel: env.openservModel,
    ixsApi: env.ixsApiBaseUrl.replace(/^https?:\/\//, ""),
    rpcKind: RPC_KIND,
    rpcUrl: env.rpcUrl,
    /** USDC a wallet must hold on a chain to be Live-capable there (Live is still opt-in). */
    liveMinUsdc: LIVE_MODE_MIN_USDC,
    /** Smallest Live deposit per vault that stays redeemable (ixv1: 104 USDC). */
    liveDepositMinimums,
    liveMode: env.liveMode,
    liveOptIn,
    maxLiveTxUsdc: env.maxLiveTxUsdc,
    redeemNavBufferPct: REDEEM_NAV_BUFFER_PCT,
    navStaleHours: env.navStaleHours,
    minDepositUsdc: MIN_DEPOSIT_USDC,
    database: store.kind,
    chainId: CHAIN_ID,
    network: CHAIN_NAME,
    deployment: {
      source: process.env.VERCEL_GIT_COMMIT_SHA ? "git" : process.env.VERCEL ? "vercel" : "local",
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      repo: process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}` : null,
    },
  };
}

/** GET /api/settings?address=0x… — user profile + policy (+ ?ping=1: OpenServ inference round-trip). */
export async function GET(req: Request) {
  const address = addressFrom(req);
  if (!address) return bad("address query param required");
  const ping = new URL(req.url).searchParams.get("ping") === "1";
  return handle(async () => ({ user: await getUser(address), system: await systemInfo(await liveOptedIn(address)), ...(ping ? { openservPing: await checkInference() } : {}) }));
}

const patchBody = z.object({
  address: addressSchema,
  daoName: z.string().trim().min(1).max(60).optional(),
  treasuryGoal: z.string().trim().max(200).optional(),
  riskProfile: z.enum(["Conservative", "Balanced", "Growth"]).optional(),
  liquidityFloorPct: z.number().int().min(0).max(90).optional(),
  maxAssetExposurePct: z.number().int().min(10).max(100).optional(),
  minVaultRiskScore: z.number().int().min(0).max(100).optional(),
  monthlyBurnUsd: z.number().min(0).optional(),
  demoMode: z.boolean().optional(),
  /** Live mode opt-in for this wallet in this browser (cookie). Off by default. */
  liveOptIn: z.boolean().optional(),
});

/** PATCH /api/settings — update treasury goal, risk policy, simulated treasury and the Live opt-in. */
export async function PATCH(req: Request) {
  const parsed = patchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "invalid body");
  const { address, liveOptIn, ...patch } = parsed.data;
  return handle(async () => {
    const optIn = liveOptIn === undefined ? await liveOptedIn(address) : await setLiveOptIn(address, liveOptIn);
    const user = Object.keys(patch).length ? await updateUser(address, patch) : await getUser(address);
    return { user, system: await systemInfo(optIn) };
  });
}

/** DELETE /api/settings?address=0x… — reset the demo state for a wallet. */
export async function DELETE(req: Request) {
  const address = addressFrom(req);
  if (!address) return bad("address query param required");
  return handle(async () => {
    await resetUser(address);
    return { ok: true };
  });
}
