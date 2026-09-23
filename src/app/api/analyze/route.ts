import { z } from "zod";
import { addressSchema, bad, handle } from "@/lib/api-utils";
import { analyze } from "@/lib/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const body = z.object({ address: addressSchema });

/** POST /api/analyze { address } — runs the OpenServ multi-agent reasoning pipeline. */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "invalid body");
  return handle(() => analyze(parsed.data.address));
}
