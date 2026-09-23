"use client";

import { useEffect } from "react";
import { fmtUsd, shortAddress } from "@/lib/format";
import type { PreparedTransaction } from "@/lib/types";
import { CHAIN_NAME, EXPLORER } from "@/lib/chain/config";
import { Icons, IxsMark, Pill, Skeleton, cx } from "@/components/ui";
import type { StepState } from "./txn-provider";

interface Props {
  prepared: PreparedTransaction | null;
  loading: boolean;
  error: string | null;
  steps: StepState[];
  executing: boolean;
  isDemo: boolean;
  onClose: () => void;
  onExecute: () => void;
  onSimulate: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line-3 py-3.5 text-[14px] font-medium text-muted last:border-0">
      <span>{label}</span>
      <span className="text-right font-semibold text-ink">{children}</span>
    </div>
  );
}

export function TxnModal({ prepared, loading, error, steps, executing, isDemo, onClose, onExecute, onSimulate }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const s = prepared?.summary;
  const onchainSteps = prepared?.steps.filter((st) => st.mode === "onchain").length ?? 0;
  const started = steps.some((st) => st.status !== "idle");
  const riskTone = s?.riskLevel === "Low" ? "green" : s?.riskLevel === "Medium" ? "amber" : "red";

  return (
    <>
      <div className="fixed inset-0 z-50 bg-navy/45" onClick={onClose} />
      <div role="dialog" aria-modal className="rise fixed left-1/2 top-1/2 z-[60] max-h-[92vh] w-[min(94vw,560px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[20px] bg-white shadow-modal">
        <div className="flex items-start justify-between px-7 pt-6">
          <div>
            <div className="eyebrow">Review transaction</div>
            <div className="mt-1.5 font-display text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">{loading ? "Preparing via IXS Agent Rail…" : (prepared ? "Allocate idle capital to IXS strategies" : "Transaction")}</div>
          </div>
          <button onClick={onClose} disabled={executing} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-canvas text-[18px] text-muted hover:text-ink disabled:opacity-40" aria-label="Close">
            ×
          </button>
        </div>

        {loading && (
          <div className="grid gap-3 px-7 py-6">
            <Skeleton className="h-20" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        )}

        {error && !loading && (
          <div className="mx-7 my-5 rounded-xl border border-amber-line bg-amber-tint p-4 text-[13px] text-amber">
            <b>Could not prepare execution.</b> {error}
          </div>
        )}

        {prepared && s && !loading && (
          <>
            <div className="mx-7 mt-5 flex items-center gap-4 rounded-[14px] bg-canvas px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-muted">From</div>
                <div className="mt-1 truncate text-[15px] font-semibold text-ink">{s.from}</div>
                <div className="text-[12px] text-faint">Idle · {shortAddress(s.fromAddress)}</div>
              </div>
              {Icons.arrow}
              <div className="min-w-0 flex-1 text-right">
                <div className="text-[12px] font-medium text-muted">Destination vault</div>
                <div className="mt-1 truncate text-[15px] font-semibold text-ink">{s.destination}</div>
                <div className="text-[12px] text-faint">{s.destinationAddress}</div>
              </div>
            </div>

            <div className="px-7 pt-2">
              <Row label="Action">{s.action}</Row>
              <Row label="Amount">
                <span className="font-display text-[22px] tracking-[-0.01em]">{fmtUsd(s.amountUsd)}</span> <span className="text-[13px] text-muted">{s.amountLabel}</span>
              </Row>
              <Row label="Expected outcome">
                <span className="text-green">{s.expectedOutcome}</span>
              </Row>
              <Row label="Risk level">
                <span className="inline-flex items-center gap-2">
                  <Pill tone={riskTone}>{s.riskLevel}</Pill>Scores {s.riskScores.join(" · ")}
                </span>
              </Row>
              <Row label="Liquidity after">
                {s.liquidityAfterPct}% <span className="font-medium text-faint">(floor {s.liquidityFloorPct}%)</span>
              </Row>
              <Row label="Execution rail">
                <span className="inline-flex items-center gap-2">
                  <IxsMark size={20} />
                  {s.rail}
                  <Pill tone={prepared.mode === "onchain" ? "green" : prepared.mode === "hybrid" ? "blue" : "muted"}>{prepared.mode === "onchain" ? "On-chain" : prepared.mode === "hybrid" ? "Hybrid" : "Simulated"}</Pill>
                </span>
              </Row>
              <Row label="Network fee">{s.feeUsd > 0 ? `≈ ${fmtUsd(s.feeUsd, { decimals: 2 })}` : "—"}</Row>
            </div>

            <div className="mx-7 mt-2 rounded-xl border border-line">
              <div className="border-b border-line-3 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.05em] text-faint">Transaction steps</div>
              {prepared.steps.map((st) => {
                const state = steps.find((x) => x.index === st.index);
                const status = state?.status ?? "idle";
                return (
                  <div key={st.index} className="flex items-center gap-3 border-b border-line-3 px-4 py-2.5 text-[13px] last:border-0">
                    <span
                      className={cx(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                        status === "confirmed" || status === "simulated" ? "bg-green text-white" : status === "failed" ? "bg-red text-white" : status === "idle" ? "bg-canvas text-muted" : "bg-blue text-white",
                      )}
                    >
                      {status === "confirmed" || status === "simulated" ? Icons.check : status === "failed" ? Icons.x : status === "idle" ? st.index + 1 : <span className="spinner" style={{ width: 12, height: 12 }} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-ink">{st.description}</div>
                      <div className="text-[11px] text-faint">
                        {st.mode === "onchain" ? `${CHAIN_NAME} · ${st.builtBy === "ixs-mcp" ? "calldata by IXS MCP" : "ERC-4626 calldata via IXS adapter"} · to ${shortAddress(st.to)}` : "Simulated IXS rail · no on-chain transaction"}
                        {status === "signing" && " · confirm in MetaMask"}
                        {status === "pending" && st.mode === "onchain" && " · waiting for confirmation"}
                        {status === "failed" && state?.error && ` · ${state.error}`}
                      </div>
                    </div>
                    {state?.hash && st.mode === "onchain" && (
                      <a href={`${EXPLORER}/tx/${state.hash}`} target="_blank" rel="noreferrer" className="text-blue-deep">
                        {Icons.external}
                      </a>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mx-7 mt-3 flex items-start gap-3 rounded-xl border border-line px-4 py-3.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-blue text-white">{Icons.check}</span>
              <span className="text-[13px] leading-relaxed text-body">
                {onchainSteps > 0
                  ? `I understand my wallet will ask me to sign ${onchainSteps} transaction${onchainSteps > 1 ? "s" : ""} on ${CHAIN_NAME}. Vaulto never holds my funds or keys; nothing moves without my signature.`
                  : isDemo
                    ? `Demo treasury: the execution runs on the simulated IXS rail and updates positions without an on-chain transaction. Connect a wallet and claim ${CHAIN_NAME} test funds to execute for real.`
                    : "No on-chain ixUSDC covers this allocation yet, so the execution will run on the simulated IXS rail. Get IXS test USDC (Faucet page), then re-run the analysis to execute for real."}
              </span>
            </div>

            <div className="flex items-center gap-2.5 px-7 pb-6 pt-5">
              <button className="btn btn-danger h-12 rounded-xl px-4 text-[15px]" onClick={onClose} disabled={executing}>
                {started ? "Close" : "Reject"}
              </button>
              <button className="btn btn-soft ml-auto h-12 rounded-xl px-4 text-[15px]" onClick={onSimulate} disabled={executing || started}>
                Simulate
              </button>
              <button className="btn btn-primary h-12 rounded-xl px-5 text-[15px]" onClick={onExecute} disabled={executing || started}>
                {executing && <span className="spinner" />}
                {executing ? "Executing…" : onchainSteps > 0 ? "Execute transaction" : "Execute (simulated)"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
