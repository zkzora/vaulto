import { z } from "zod";
import { addressSchema, bad, handle } from "@/lib/api-utils";
import { collectEvidence } from "@/lib/evidence";
import { analyze } from "@/lib/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 240;

const body = z.object({ address: addressSchema, fresh: z.boolean().optional() });

/**
 * POST /api/analyze { address, fresh? } — runs the OpenServ multi-agent reasoning pipeline. A stored SERV output for
 * identical inputs is reused unless fresh is true ("Re-run SERV").
 */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "invalid body");
  return handle(async () => {
    const { result, evidence } = await collectEvidence(() => analyze(parsed.data.address, { fresh: parsed.data.fresh }));
    return { ...result, evidence };
  });
}
