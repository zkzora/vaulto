import { addressFrom, bad, handle } from "@/lib/api-utils";
import { currentRecommendation, scan } from "@/lib/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/treasury?address=0x… — treasury snapshot for the wallet (on-chain + hybrid demo). */
export async function GET(req: Request) {
  const address = addressFrom(req);
  if (!address) return bad("address query param required");
  return handle(async () => {
    const result = await scan(address);
    const recommendation = await currentRecommendation(address, result.snapshot);
    return { ...result, recommendation };
  });
}
