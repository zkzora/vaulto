import { addressFrom, bad, handle } from "@/lib/api-utils";
import { activity } from "@/lib/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/activity?address=0x… — agent logs and transaction history. */
export async function GET(req: Request) {
  const address = addressFrom(req);
  if (!address) return bad("address query param required");
  return handle(() => activity(address));
}
