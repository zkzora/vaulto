import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { z } from "zod";

export const addressSchema = z
  .string()
  .trim()
  .refine((v) => isAddress(v, { strict: false }), "invalid wallet address")
  .transform((v) => v.toLowerCase());

export function addressFrom(req: Request): string | null {
  const url = new URL(req.url);
  const raw = url.searchParams.get("address") ?? "";
  const parsed = addressSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { "cache-control": "no-store", ...(init?.headers ?? {}) } });
}

export async function handle<T>(fn: () => Promise<T>) {
  try {
    return ok(await fn());
  } catch (e) {
    const message = e instanceof Error ? e.message : "internal error";
    console.error("[api]", message);
    return bad(message, /not found/i.test(message) ? 404 : 500);
  }
}
