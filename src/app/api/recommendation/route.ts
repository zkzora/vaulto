import { z } from "zod";
import { addressFrom, addressSchema, bad, handle } from "@/lib/api-utils";
import { analyze, currentRecommendation, latestRecommendation, scan, setRecommendationStatus } from "@/lib/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/** GET /api/recommendation?address=0x… — latest recommendation. */
export async function GET(req: Request) {
  const address = addressFrom(req);
  if (!address) return bad("address query param required");
  return handle(async () => ({ recommendation: await latestRecommendation(address) }));
}

const postBody = z.object({ address: addressSchema, fresh: z.boolean().optional() });

/** POST /api/recommendation { address, fresh? } — returns the open recommendation or generates one. */
export async function POST(req: Request) {
  const parsed = postBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "invalid body");
  return handle(async () => {
    const existing = parsed.data.fresh ? null : await currentRecommendation(parsed.data.address, (await scan(parsed.data.address)).snapshot);
    if (existing && existing.status === "proposed") return { recommendation: existing, generated: false };
    const result = await analyze(parsed.data.address);
    return { recommendation: result.recommendation, generated: true, snapshot: result.snapshot };
  });
}

const patchBody = z.object({
  address: addressSchema,
  id: z.string().min(1),
  status: z.enum(["proposed", "approved", "executed", "rejected", "dismissed"]),
});

/** PATCH /api/recommendation { address, id, status } — dismiss / reject. */
export async function PATCH(req: Request) {
  const parsed = patchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "invalid body");
  return handle(async () => ({ recommendation: await setRecommendationStatus(parsed.data.address, parsed.data.id, parsed.data.status) }));
}
