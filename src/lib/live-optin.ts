import { cookies } from "next/headers";
import { LIVE_OPT_IN_COOKIE } from "@/lib/chain/config";
import { env } from "@/lib/env";

/**
 * Live mode is opt-in: the default everywhere is Simulate (eth_call + state override). A viewer enables Live for a
 * wallet in Settings; the choice lives in an httpOnly cookie on that browser, so it survives serverless instances
 * without a database. Live still requires the wallet's signature for every transaction.
 */
const parse = (v?: string) =>
  new Set(
    (v ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^0x[0-9a-f]{40}$/.test(s)),
  );

export async function liveOptedIn(address: string): Promise<boolean> {
  if (env.liveMode === "off") return false;
  try {
    const jar = await cookies();
    return parse(jar.get(LIVE_OPT_IN_COOKIE)?.value).has(address.toLowerCase());
  } catch {
    return false; // outside a request (scripts, the OpenServ agent runner)
  }
}

export async function setLiveOptIn(address: string, on: boolean): Promise<boolean> {
  const jar = await cookies();
  const set = parse(jar.get(LIVE_OPT_IN_COOKIE)?.value);
  const a = address.toLowerCase();
  if (on && env.liveMode !== "off") set.add(a);
  else set.delete(a);
  if (set.size) jar.set(LIVE_OPT_IN_COOKIE, [...set].slice(-5).join(","), { path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30 });
  else jar.delete(LIVE_OPT_IN_COOKIE);
  return set.has(a);
}
