"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { usePublicClient, useSendTransaction, useSwitchChain } from "wagmi";
import { erc20Abi } from "@/lib/chain/abi";
import { CHAIN_ID, CHAIN_NAME } from "@/lib/chain/config";
import { api } from "@/lib/client-api";
import { fmtUsd } from "@/lib/format";
import type { PreparedTransaction, TxStatus } from "@/lib/types";
import { useVaultoAccount } from "@/hooks/use-account";
import { TxnModal } from "./txn-modal";
import { Toast, type ToastData } from "./toast";

export type StepState = { index: number; status: "idle" | "signing" | "pending" | "confirmed" | "simulated" | "failed"; hash?: string; error?: string };

interface TxnContext {
  open: (recommendationId: string, opts?: { simulate?: boolean }) => void;
  close: () => void;
  notify: (data: ToastData) => void;
}

const Ctx = createContext<TxnContext | null>(null);

export function TxnProvider({ children }: { children: ReactNode }) {
  const account = useVaultoAccount();
  const router = useRouter();
  const qc = useQueryClient();
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();

  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedTransaction | null>(null);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [executing, setExecuting] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);

  const load = useCallback(
    async (recommendationId: string, simulate: boolean) => {
      if (!account.address) return;
      setLoading(true);
      setError(null);
      setPrepared(null);
      try {
        const { prepared } = await api.prepare(account.address, recommendationId, simulate || account.isDemo);
        setPrepared(prepared);
        setSteps(prepared.steps.map((s) => ({ index: s.index, status: "idle" })));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not prepare transaction");
      } finally {
        setLoading(false);
      }
    },
    [account.address, account.isDemo],
  );

  const open = useCallback(
    (recommendationId: string, opts?: { simulate?: boolean }) => {
      setVisible(true);
      void load(recommendationId, opts?.simulate ?? false);
    },
    [load],
  );

  const close = useCallback(() => {
    if (executing) return;
    setVisible(false);
    setPrepared(null);
    setError(null);
  }, [executing]);

  const update = (index: number, patch: Partial<StepState>) => setSteps((prev) => prev.map((s) => (s.index === index ? { ...s, ...patch } : s)));

  const execute = useCallback(
    async (mode: "execute" | "simulate") => {
      if (!prepared || !account.address) return;
      setExecuting(true);
      setError(null);
      const results: { index: number; hash?: string; status: TxStatus; error?: string }[] = [];
      let aborted = false;

      for (const step of prepared.steps) {
        if (aborted) {
          results.push({ index: step.index, status: "failed", error: "skipped" });
          update(step.index, { status: "failed", error: "Skipped" });
          continue;
        }
        const simulated = mode === "simulate" || step.mode === "simulated";
        if (simulated) {
          update(step.index, { status: "pending" });
          await new Promise((r) => setTimeout(r, 650));
          const hash = `0xsim${Array.from({ length: 60 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
          update(step.index, { status: "simulated", hash });
          results.push({ index: step.index, hash, status: "simulated" });
          continue;
        }
        try {
          update(step.index, { status: "signing" });
          if (account.chainId !== step.chainId) await switchChainAsync({ chainId: step.chainId });
          // Public RPC nodes can lag behind the previous receipt: wait until the precondition is visible.
          if (step.precheck?.kind === "allowance" && publicClient) {
            const need = BigInt(step.precheck.amount);
            for (let i = 0; i < 20; i++) {
              const allowance = await publicClient.readContract({ address: step.precheck.token, abi: erc20Abi, functionName: "allowance", args: [account.address as `0x${string}`, step.precheck.spender] }).catch(() => 0n);
              if (allowance >= need) break;
              await new Promise((r) => setTimeout(r, 1500));
            }
          }
          let hash: `0x${string}` | undefined;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              hash = await sendTransactionAsync({ to: step.to, data: step.data, value: BigInt(step.value || "0"), chainId: step.chainId });
              break;
            } catch (err) {
              const msg = err instanceof Error ? err.message : "";
              if (attempt === 2 || !/reverted|estimateGas|allowance/i.test(msg) || /rejected/i.test(msg)) throw err;
              await new Promise((r) => setTimeout(r, 2500));
            }
          }
          if (!hash) throw new Error("Transaction was not sent");
          update(step.index, { status: "pending", hash });
          const receipt = await publicClient!.waitForTransactionReceipt({ hash, confirmations: 1 });
          if (receipt.status !== "success") throw new Error("Transaction reverted");
          update(step.index, { status: "confirmed", hash });
          results.push({ index: step.index, hash, status: "confirmed" });
        } catch (e) {
          const msg = e instanceof Error ? (e.message.includes("User rejected") || e.message.includes("rejected") ? "Rejected in wallet" : e.message.split("\n")[0].slice(0, 140)) : "failed";
          update(step.index, { status: "failed", error: msg });
          results.push({ index: step.index, status: "failed", error: msg });
          aborted = true;
        }
      }

      try {
        await api.finalize(account.address, prepared.id, results);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not record execution");
      }
      setExecuting(false);
      // give the RPC a moment to settle so the dashboard refetch reflects the new positions
      await new Promise((r) => setTimeout(r, 1500));
      await qc.invalidateQueries();

      const ok = results.filter((r) => r.status === "confirmed" || r.status === "simulated").length;
      const failed = results.some((r) => r.status === "failed");
      if (ok > 0 && !failed) {
        setVisible(false);
        setPrepared(null);
        const onchain = results.some((r) => r.status === "confirmed");
        setToast({
          title: onchain ? `Transactions confirmed on ${CHAIN_NAME} via IXS` : "Transaction submitted via IXS Agent Rail",
          body: `Allocate ${fmtUsd(prepared.summary.amountUsd)} → ${prepared.summary.destination}${onchain ? " · view on BscScan from Activity" : " · simulated rail, positions updated"}`,
        });
        router.push("/app");
        setTimeout(() => setToast(null), 7000);
      }
    },
    [prepared, account.address, account.chainId, publicClient, qc, router, sendTransactionAsync, switchChainAsync],
  );

  const notify = useCallback((data: ToastData) => {
    setToast(data);
    setTimeout(() => setToast((t) => (t === data ? null : t)), 6000);
  }, []);

  const value = useMemo(() => ({ open, close, notify }), [open, close, notify]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {visible && (
        <TxnModal prepared={prepared} loading={loading} error={error} steps={steps} executing={executing} onClose={close} onExecute={() => execute("execute")} onSimulate={() => execute("simulate")} isDemo={account.isDemo} />
      )}
      {toast && <Toast data={toast} onClose={() => setToast(null)} />}
    </Ctx.Provider>
  );
}

export function useTxn() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTxn must be used within TxnProvider");
  return ctx;
}
