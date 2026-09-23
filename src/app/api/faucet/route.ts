import { z } from "zod";
import { addressFrom, addressSchema, bad, handle } from "@/lib/api-utils";
import { getStore } from "@/lib/db";
import { DEMO_ADDRESS } from "@/lib/demo";
import { CHAIN_NAME } from "@/lib/chain/config";
import { invalidateOnchain } from "@/lib/chain/treasury";
import { FAUCET_COOLDOWN_MS, MIN_FAUCET_NATIVE, claimFaucet, faucetStatus } from "@/lib/faucet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/** GET /api/faucet?address=0x… — faucet status and whether the wallet can claim now. */
export async function GET(req: Request) {
  const address = addressFrom(req);
  return handle(async () => {
    const status = await faucetStatus();
    let nextClaimAt: string | null = null;
    if (address) {
      const store = await getStore();
      const last = await store.getFaucetClaim(address);
      if (last && Date.now() - new Date(last).getTime() < FAUCET_COOLDOWN_MS) nextClaimAt = last;
    }
    let reason: string | null = null;
    if (!status.configured) reason = "Faucet key not configured on the server.";
    else if (address === DEMO_ADDRESS) reason = "The demo treasury is simulated; connect a browser wallet to claim.";
    else if (nextClaimAt) reason = `This wallet already claimed on ${new Date(nextClaimAt).toLocaleString()}. One claim per wallet.`;
    else if (status.faucetLow) reason = `Faucet wallet is low on ${status.nativeSymbol} (${(status.faucetNativeBalance ?? 0).toFixed(4)}); it needs at least ${MIN_FAUCET_NATIVE} to send. Top it up at ${status.faucetAddress}.`;
    return { ...status, nextClaimAt, reason, canClaim: !reason };
  });
}

const body = z.object({ address: addressSchema });

/** POST /api/faucet { address } — sends tBNB for gas and forwards IXS test USDC while the faucet holds some (real transactions). */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "invalid body");
  const address = parsed.data.address;
  if (address === DEMO_ADDRESS) return bad("The demo treasury cannot claim from the faucet. Connect MetaMask.");
  return handle(async () => {
    const store = await getStore();
    const last = await store.getFaucetClaim(address);
    if (last && Date.now() - new Date(last).getTime() < FAUCET_COOLDOWN_MS) {
      throw new Error(`This wallet already claimed on ${new Date(last).toLocaleString()}. The faucet allows one claim per wallet.`);
    }
    const result = await claimFaucet(address);
    invalidateOnchain(address);
    await store.setFaucetClaim(address, new Date().toISOString());
    await store.addLog({
      walletAddress: address,
      agentName: "Vaulto Faucet",
      action: "faucet",
      reasoning: `Sent ${result.txs.map((t) => `${t.amount} ${t.asset}`).join(", ")} to the treasury wallet on ${CHAIN_NAME} (${result.txs.length} on-chain tx).`,
      status: "success",
      source: "Vaulto",
    });
    return result;
  });
}
