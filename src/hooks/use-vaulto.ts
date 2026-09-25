"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import type { AgentLog, AnalysisResult, Recommendation, RecommendationStatus, TransactionRecord, UserPatch } from "@/lib/types";
import { useVaultoAccount } from "./use-account";

/** Recommendations are kept per view: the current state, or one replay block. */
const recKey = (address: string, replayBlock?: number | null) => `vaulto:rec:${address.toLowerCase()}${replayBlock ? `@${replayBlock}` : ""}`;
const actKey = (address: string) => `vaulto:activity:${address.toLowerCase()}`;
const EVIDENCE_KEY = "vaulto:evidence";

export type BrowserEvidence = NonNullable<AnalysisResult["evidence"]>[number];

/** Evidence returned by this browser's own requests (serverless instances do not share the in-memory log). */
export function recallEvidence(): BrowserEvidence[] {
  try {
    return JSON.parse(localStorage.getItem(EVIDENCE_KEY) ?? "[]") as BrowserEvidence[];
  } catch {
    return [];
  }
}

export function rememberEvidence(entries?: BrowserEvidence[]) {
  if (!entries?.length) return;
  const current = recallEvidence();
  const seen = new Set(current.map((e) => e.id));
  const merged = [...[...entries].reverse().filter((e) => !seen.has(e.id)), ...current];
  for (const n of [80, 30, 10]) {
    try {
      localStorage.setItem(EVIDENCE_KEY, JSON.stringify(merged.slice(0, n)));
      return;
    } catch {
      // quota: keep fewer entries
    }
  }
}

type Activity = { logs: AgentLog[]; transactions: TransactionRecord[] };

function recallActivity(address: string): Activity {
  try {
    const a = JSON.parse(localStorage.getItem(actKey(address)) ?? "null") as Activity | null;
    return { logs: a?.logs ?? [], transactions: a?.transactions ?? [] };
  } catch {
    return { logs: [], transactions: [] };
  }
}

const byNewest = <T extends { id: string; createdAt: string }>(a: T[], b: T[]) => {
  const map = new Map<string, T>();
  for (const x of [...b, ...a]) map.set(x.id, x);
  return [...map.values()].sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 150);
};

/** Agent logs and transactions seen by this browser, merged with what the server instance returns. */
export function rememberActivity(address: string, patch: Partial<Activity>) {
  try {
    const cur = recallActivity(address);
    localStorage.setItem(actKey(address), JSON.stringify({ logs: byNewest(patch.logs ?? [], cur.logs), transactions: byNewest(patch.transactions ?? [], cur.transactions) }));
  } catch {
    // ignore
  }
}

/** Last recommendation per wallet, kept in the browser: serverless instances do not share the JSON store. */
export function rememberRecommendation(address: string, rec: Recommendation | null, replayBlock?: number | null) {
  try {
    const key = recKey(address, rec?.context?.replayBlock ?? replayBlock ?? null);
    if (rec) localStorage.setItem(key, JSON.stringify(rec));
    else localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function recallRecommendation(address: string, replayBlock?: number | null): Recommendation | null {
  try {
    const raw = localStorage.getItem(recKey(address, replayBlock ?? null));
    return raw ? (JSON.parse(raw) as Recommendation) : null;
  } catch {
    return null;
  }
}

export function useTreasury() {
  const { address } = useVaultoAccount();
  return useQuery({
    queryKey: ["treasury", address],
    queryFn: async () => {
      const data = await api.treasury(address!);
      if (data.recommendation) rememberRecommendation(address!, data.recommendation);
      else {
        const cached = recallRecommendation(address!, data.snapshot.replay?.block ?? null);
        if (cached && cached.context?.demoMode === data.snapshot.demoMode && (cached.context?.replayBlock ?? null) === (data.snapshot.replay?.block ?? null)) data.recommendation = cached;
      }
      return data;
    },
    enabled: Boolean(address),
    refetchInterval: 60_000,
  });
}

export function useStrategies() {
  return useQuery({ queryKey: ["vaults"], queryFn: api.vaults, staleTime: 60_000 });
}

export function useMainnetVaults() {
  return useQuery({ queryKey: ["ixs-mainnet"], queryFn: api.mainnet, staleTime: 5 * 60_000 });
}

export function useActivity() {
  const { address } = useVaultoAccount();
  return useQuery({
    queryKey: ["activity", address],
    queryFn: async () => {
      const data = await api.activity(address!);
      rememberActivity(address!, data);
      return recallActivity(address!);
    },
    enabled: Boolean(address),
    refetchInterval: 20_000,
  });
}

export function useRisk() {
  const { address } = useVaultoAccount();
  return useQuery({ queryKey: ["risk", address], queryFn: () => api.risk(address!), enabled: Boolean(address) });
}

export function usePortfolio(period: number) {
  const { address } = useVaultoAccount();
  return useQuery({ queryKey: ["portfolio", address, period], queryFn: () => api.portfolio(address!, period), enabled: Boolean(address) });
}

export function useSettings() {
  const { address } = useVaultoAccount();
  return useQuery({ queryKey: ["settings", address], queryFn: () => api.settings(address!), enabled: Boolean(address) });
}

export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function useAnalyze() {
  const { address } = useVaultoAccount();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.analyze(address!),
    onSuccess: (result) => {
      rememberRecommendation(address!, result.recommendation);
      rememberActivity(address!, { logs: result.logs });
      rememberEvidence(result.evidence);
      qc.invalidateQueries();
    },
  });
}

export function useRecommendationStatus() {
  const { address } = useVaultoAccount();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: RecommendationStatus }) => api.setRecommendationStatus(address!, id, status),
    onSuccess: (result, vars) => {
      for (const block of [null, ...(result.recommendation?.context?.replayBlock ? [result.recommendation.context.replayBlock] : [])]) {
        const cached = recallRecommendation(address!, block);
        if (cached && cached.id === vars.id) rememberRecommendation(address!, { ...cached, status: vars.status });
      }
      if (result.recommendation) rememberRecommendation(address!, result.recommendation);
      qc.invalidateQueries();
    },
  });
}

/** Replay view of this browser (null = current state) and the blocks it can pick. */
export function useReplayInfo() {
  return useQuery({ queryKey: ["replay"], queryFn: api.replay, staleTime: 60_000 });
}

/** Switch between the current state (null) and a replay block; every view refetches. */
export function useSetReplay() {
  const { address } = useVaultoAccount();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (block: number | null) => api.setReplay(address!, block),
    onSuccess: () => qc.invalidateQueries(),
  });
}

/** Live mode is opt-in per wallet and browser; the server keeps it in a cookie. */
export function useSetLiveOptIn() {
  const { address } = useVaultoAccount();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => api.setLiveOptIn(address!, on),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useUpdateSettings() {
  const { address } = useVaultoAccount();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UserPatch) => api.updateSettings(address!, patch),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useEvidence() {
  return useQuery({ queryKey: ["evidence"], queryFn: api.evidence, refetchInterval: 30_000 });
}

export function useSimulate() {
  const { address } = useVaultoAccount();
  return useMutation({
    mutationFn: ({ strategyId, amount, action, shares }: { strategyId: string; amount?: number; action?: "deposit" | "redeem"; shares?: number }) => api.simulate(address!, strategyId, amount, action ?? "deposit", shares),
    onSuccess: (r) => rememberEvidence(r.evidence),
  });
}

export function useResetDemo() {
  const { address } = useVaultoAccount();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.reset(address!),
    onSuccess: () => qc.invalidateQueries(),
  });
}
