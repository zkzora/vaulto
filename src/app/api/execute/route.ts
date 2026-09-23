import { z } from "zod";
import { addressSchema, bad, handle } from "@/lib/api-utils";
import { finalize, prepare } from "@/lib/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const prepareBody = z.object({
  address: addressSchema,
  recommendationId: z.string().min(1),
  simulate: z.boolean().optional().default(false),
});

/** POST /api/execute { address, recommendationId, simulate? } — prepares the execution workflow. */
export async function POST(req: Request) {
  const parsed = prepareBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "invalid body");
  return handle(async () => ({ prepared: await prepare(parsed.data.address, parsed.data.recommendationId, parsed.data.simulate) }));
}

const finalizeBody = z.object({
  address: addressSchema,
  preparedId: z.string().min(1),
  results: z.array(
    z.object({
      index: z.number().int().min(0),
      hash: z.string().optional(),
      status: z.enum(["prepared", "pending", "confirmed", "failed", "simulated"]),
      error: z.string().optional(),
    }),
  ),
});

/** PUT /api/execute { address, preparedId, results } — records signed / simulated step outcomes. */
export async function PUT(req: Request) {
  const parsed = finalizeBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "invalid body");
  return handle(() => finalize(parsed.data.address, parsed.data.preparedId, parsed.data.results));
}
