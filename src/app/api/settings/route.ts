import { z } from "zod";
import { addressFrom, addressSchema, bad, handle } from "@/lib/api-utils";
import { CHAIN_ID, CHAIN_NAME, LIVE_MODE_MIN_USDC, MIN_DEPOSIT_USDC } from "@/lib/chain/config";
import { RPC_KIND } from "@/lib/chain/client";
import { env, openservConfigured } from "@/lib/env";
import { checkInference } from "@/lib/openserv/inference";
import { getStore } from "@/lib/db";
import { getUser, resetUser, updateUser } from "@/lib/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function systemInfo() {
  const store = await getStore();
  return {
    openserv: openservConfigured(),
    openservKey: Boolean(env.openservApiKey),
    openservWorkspace: Boolean(env.openservWorkspaceId),
    openservMode: env.openservReasoningMode,
    openservModel: env.openservModel,
    ixsApi: env.ixsApiBaseUrl.replace(/^https?:\/\//, ""),
    rpcKind: RPC_KIND,
    rpcUrl: env.rpcUrl,
    liveMinUsdc: LIVE_MODE_MIN_USDC,
    maxLiveTxUsdc: env.maxLiveTxUsdc,
    navStaleHours: env.navStaleHours,
    minDepositUsdc: MIN_DEPOSIT_USDC,
    database: store.kind,
    chainId: CHAIN_ID,
    network: CHAIN_NAME,
  };
}

/** GET /api/settings?address=0x… — user profile + policy. */
export async function GET(req: Request) {
  const address = addressFrom(req);
  if (!address) return bad("address query param required");
  const ping = new URL(req.url).searchParams.get("ping") === "1";
  return handle(async () => ({ user: await getUser(address), system: await systemInfo(), ...(ping ? { openservPing: await checkInference() } : {}) }));
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
});

/** PATCH /api/settings — update treasury goal, risk policy and demo mode. */
export async function PATCH(req: Request) {
  const parsed = patchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "invalid body");
  const { address, ...patch } = parsed.data;
  return handle(async () => ({ user: await updateUser(address, patch), system: await systemInfo() }));
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
