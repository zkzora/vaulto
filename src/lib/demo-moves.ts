import { cookies } from "next/headers";
import type { DemoMove } from "@/lib/types";

/**
 * Simulated deposits of the simulated treasury, kept in an httpOnly cookie of this browser. On Vercel every API route
 * is its own serverless function with its own memory, so a move recorded by /api/execute is never seen by the scan in
 * /api/treasury; the cookie travels with every request instead. Moves are scoped per treasury and per view (Current,
 * or the Replay block they were simulated at), so a deposit simulated at a past block never shows up in today's state.
 */
export const DEMO_MOVES_COOKIE = "vaulto_demo_moves";

// [strategyId, asset, amount, unix seconds, replay block or 0 for Current]
type Row = [string, string, number, number, number];
type Jar = Record<string, Row[]>;

const MAX_ROWS_PER_TREASURY = 12;
const MAX_TREASURIES = 4;

async function read(): Promise<Jar> {
  try {
    const raw = (await cookies()).get(DEMO_MOVES_COOKIE)?.value;
    if (!raw) return {};
    const jar = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Jar;
    return jar && typeof jar === "object" ? jar : {};
  } catch {
    return {}; // outside a request, or an unreadable cookie
  }
}

async function write(jar: Jar) {
  const store = await cookies();
  const keys = Object.keys(jar).filter((k) => jar[k]?.length);
  if (!keys.length) {
    store.delete(DEMO_MOVES_COOKIE);
    return;
  }
  const trimmed: Jar = Object.fromEntries(keys.slice(-MAX_TREASURIES).map((k) => [k, jar[k].slice(-MAX_ROWS_PER_TREASURY)]));
  store.set(DEMO_MOVES_COOKIE, Buffer.from(JSON.stringify(trimmed)).toString("base64url"), { path: "/", sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30 });
}

/** Simulated deposits of this treasury in this view (replayBlock null = Current). */
export async function cookieDemoMoves(address: string, replayBlock: number | null): Promise<DemoMove[]> {
  const rows = (await read())[address.toLowerCase()] ?? [];
  return rows
    .filter((r) => Array.isArray(r) && r.length === 5 && (r[4] || null) === (replayBlock ?? null))
    .map(([strategyId, asset, amount, at, block]) => ({ strategyId, asset, amount, at: new Date(at * 1000).toISOString(), replayBlock: block || null }));
}

export async function addCookieDemoMoves(address: string, moves: DemoMove[]) {
  if (!moves.length) return;
  const jar = await read();
  const a = address.toLowerCase();
  const rows = jar[a] ?? [];
  for (const m of moves) rows.push([m.strategyId, m.asset, Math.round(m.amount * 1e6) / 1e6, Math.floor(new Date(m.at).getTime() / 1000), m.replayBlock ?? 0]);
  delete jar[a]; // re-insert last so the most recent treasuries are kept
  jar[a] = rows;
  await write(jar);
}

export async function clearCookieDemoMoves(address: string) {
  const jar = await read();
  delete jar[address.toLowerCase()];
  await write(jar);
}
