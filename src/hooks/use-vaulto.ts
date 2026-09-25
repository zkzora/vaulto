"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import type { Recommendation, RecommendationStatus, UserPatch } from "@/lib/types";
import { useVaultoAccount } from "./use-account";

const recKey = (address: string) => `vaulto:rec:${address.toLowerCase()}`;

/** Last recommendation per wallet, kept in the browser: serverless instances do not share the JSON store. */
export function rememberRecommendation(address: string, rec: Recommendation | null) {
  try {
    if (rec) localStorage.setItem(recKey(address), JSON.stringify(rec));
    else localStorage.removeItem(recKey(address));
  } catch {
    // ignore
  }
}

export function recallRecommendation(address: string): Recommendation | null {
  try {
    const raw = localStorage.getItem(recKey(address));
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
        const cached = recallRecommendation(address!);
        if (cached && cached.context?.demoMode === data.snapshot.demoMode) data.recommendation = cached;
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
  return useQuery({ queryKey: ["activity", address], queryFn: () => api.activity(address!), enabled: Boolean(address), refetchInterval: 20_000 });
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
      const cached = recallRecommendation(address!);
      if (cached && cached.id === vars.id) rememberRecommendation(address!, { ...cached, status: vars.status });
      if (result.recommendation) rememberRecommendation(address!, result.recommendation);
      qc.invalidateQueries();
    },
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
  return useMutation({ mutationFn: ({ strategyId, amount, action, shares }: { strategyId: string; amount?: number; action?: "deposit" | "redeem"; shares?: number }) => api.simulate(address!, strategyId, amount, action ?? "deposit", shares) });
}

export function useResetDemo() {
  const { address } = useVaultoAccount();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.reset(address!),
    onSuccess: () => qc.invalidateQueries(),
  });
}
