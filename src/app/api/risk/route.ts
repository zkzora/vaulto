import { addressFrom, bad, handle } from "@/lib/api-utils";
import { riskReport } from "@/lib/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/risk?address=0x… — Monitoring Agent risk report. */
export async function GET(req: Request) {
  const address = addressFrom(req);
  if (!address) return bad("address query param required");
  return handle(() => riskReport(address));
}
