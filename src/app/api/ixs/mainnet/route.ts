import { handle } from "@/lib/api-utils";
import { getMainnetVaults } from "@/lib/ixs/mainnet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/ixs/mainnet — read-only view of the IXS production vaults (BNB Chain + Avalanche). */
export async function GET() {
  return handle(() => getMainnetVaults());
}
