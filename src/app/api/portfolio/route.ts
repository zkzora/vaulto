import { addressFrom, bad, handle } from "@/lib/api-utils";
import { portfolioReport } from "@/lib/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/portfolio?address=0x…&period=30 — portfolio history and target vs actual. */
export async function GET(req: Request) {
  const address = addressFrom(req);
  if (!address) return bad("address query param required");
  const period = Number(new URL(req.url).searchParams.get("period") ?? 30);
  return handle(() => portfolioReport(address, [7, 30, 90, 365].includes(period) ? period : 30));
}
