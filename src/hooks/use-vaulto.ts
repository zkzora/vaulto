"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import type { RecommendationStatus, UserPatch } from "@/lib/types";
import { useVaultoAccount } from "./use-account";

export function useTreasury() {
  const { address } = useVaultoAccount();
  return useQuery({
    queryKey: ["treasury", address],
    queryFn: () => api.treasury(address!),
    enabled: Boolean(address),
    refetchInterval: 60_000,
  });
}

export function useStrategies() {
  return useQuery({ queryKey: ["vaults"], queryFn: api.vaults, staleTime: 60_000 });
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
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useRecommendationStatus() {
  const { address } = useVaultoAccount();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: RecommendationStatus }) => api.setRecommendationStatus(address!, id, status),
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

export function useResetDemo() {
  const { address } = useVaultoAccount();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.reset(address!),
    onSuccess: () => qc.invalidateQueries(),
  });
}
