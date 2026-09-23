import { handle } from "@/lib/api-utils";
import { loadStrategies } from "@/lib/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/vaults — IXS strategy catalog (curated + live from the IXS Vault API). */
export async function GET() {
  return handle(() => loadStrategies());
}
