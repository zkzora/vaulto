import { env } from "@/lib/env";
import { fileStore } from "./memory";
import type { Store } from "./store";

let store: Store | null = null;

/** PostgreSQL (Prisma) when DATABASE_URL is set, otherwise the JSON file store. */
export async function getStore(): Promise<Store> {
  if (store) return store;
  if (env.databaseUrl) {
    try {
      const mod = await import("./prisma");
      store = mod.prismaStore;
      return store;
    } catch (e) {
      console.warn("[store] Prisma unavailable, using file store:", e instanceof Error ? e.message : e);
    }
  }
  store = fileStore;
  return store;
}

export { normalizeAddress } from "./store";
