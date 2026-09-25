import { recordEvidence } from "@/lib/evidence";
import type { Registry, RegistryVault } from "./registry";

/**
 * NAV + deposit-limit watcher. Every registry refresh is compared with the last observation; a vault whose
 * deposit limit moves from 0 to > 0, or whose NAV timestamp changes, produces an event that the Monitoring Agent
 * logs and the UI surfaces as a notification. Per IXS (24 Sep 2026) a limit of 0 is the NAV-staleness effect, so
 * vaults in that state are listed as "waiting NAV refresh".
 */

export interface WatchEvent {
  id: string;
  at: string;
  routeId: string;
  vault: string;
  chainName: string;
  kind: "limit" | "nav";
  from: string;
  to: string;
  message: string;
}

export interface WatchEntry {
  routeId: string;
  vault: string;
  symbol: string;
  chainName: string;
  chainId: number;
  depositLimitUsd: number | null;
  depositLimitUnlimited: boolean;
  navUpdatedAt: number | null;
  navAgeHours: number | null;
  pricePerShare: number | null;
  waitingNavRefresh: boolean;
  observedAt: string;
  block: number | null;
}

interface State {
  entries: Record<string, WatchEntry>;
  events: WatchEvent[];
}

const g = globalThis as unknown as { __vaultoWatch?: State };
const state = (): State => (g.__vaultoWatch ??= { entries: {}, events: [] });

const limitText = (e: { depositLimitUsd: number | null; depositLimitUnlimited: boolean }) => (e.depositLimitUnlimited ? "unlimited" : e.depositLimitUsd == null ? "unknown" : `${e.depositLimitUsd} USDC`);

function entryOf(v: RegistryVault): WatchEntry {
  return {
    routeId: v.routeId,
    vault: v.name,
    symbol: v.symbol,
    chainName: v.chainName,
    chainId: v.chainId,
    depositLimitUsd: v.depositLimit.unlimited ? null : v.depositLimit.usd,
    depositLimitUnlimited: v.depositLimit.unlimited,
    navUpdatedAt: v.nav.updatedAt,
    navAgeHours: v.nav.ageHours,
    pricePerShare: v.nav.pricePerShare,
    waitingNavRefresh: !v.depositLimit.unlimited && (v.depositLimit.usd ?? 0) === 0 && !v.requiresWhitelist,
    observedAt: v.readAt,
    block: v.blockNumber,
  };
}

/** Compare the registry with the previous observation; returns the new events (also kept in memory). */
export function watchRegistry(registry: Registry): WatchEvent[] {
  const s = state();
  const fresh: WatchEvent[] = [];
  for (const v of registry.vaults) {
    const next = entryOf(v);
    const prev = s.entries[v.routeId];
    if (prev) {
      const prevLimit = limitText(prev);
      const nextLimit = limitText(next);
      if (prevLimit !== nextLimit) {
        const reopened = (prev.depositLimitUsd ?? 0) === 0 && !prev.depositLimitUnlimited && (next.depositLimitUnlimited || (next.depositLimitUsd ?? 0) > 0);
        fresh.push({ id: `${v.routeId}:limit:${Date.now()}`, at: next.observedAt, routeId: v.routeId, vault: `${v.name} · ${v.chainName} (${v.symbol})`, chainName: v.chainName, kind: "limit", from: prevLimit, to: nextLimit, message: reopened ? `${v.chainName} vault reopened: deposit limit ${prevLimit} → ${nextLimit}. Re-run the analysis to route capital there.` : `${v.chainName} vault deposit limit changed ${prevLimit} → ${nextLimit}.` });
      }
      if (prev.navUpdatedAt !== next.navUpdatedAt && next.navUpdatedAt != null) {
        fresh.push({ id: `${v.routeId}:nav:${Date.now()}`, at: next.observedAt, routeId: v.routeId, vault: `${v.name} · ${v.chainName} (${v.symbol})`, chainName: v.chainName, kind: "nav", from: prev.navUpdatedAt ? new Date(prev.navUpdatedAt * 1000).toISOString() : "unknown", to: new Date(next.navUpdatedAt * 1000).toISOString(), message: `${v.chainName} vault NAV refreshed at ${new Date(next.navUpdatedAt * 1000).toISOString()} (${next.pricePerShare?.toFixed(6) ?? "?"} per share).` });
      }
    }
    s.entries[v.routeId] = next;
  }
  if (fresh.length) {
    s.events.push(...fresh);
    if (s.events.length > 100) s.events.splice(0, s.events.length - 100);
    recordEvidence({ kind: "onchain", label: "NAV / deposit-limit watcher: change detected", request: null, response: fresh, ok: true });
  }
  return fresh;
}

export function watchStatus(): { entries: WatchEntry[]; events: WatchEvent[]; waiting: WatchEntry[] } {
  const s = state();
  const entries = Object.values(s.entries);
  return { entries, events: [...s.events].reverse().slice(0, 20), waiting: entries.filter((e) => e.waitingNavRefresh) };
}
