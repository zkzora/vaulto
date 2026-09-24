"use client";

import { useEffect } from "react";
import { fmtUsd, shortAddress } from "@/lib/format";
import type { PreparedTransaction, StepSimulation } from "@/lib/types";
import { LIVE_MODE_MIN_USDC, chainInfo } from "@/lib/chain/config";
import { Icons, IxsMark, Pill, Skeleton, cx } from "@/components/ui";
import type { StepState } from "./txn-provider";

interface Props {
  prepared: PreparedTransaction | null;
  loading: boolean;
  error: string | null;
  steps: StepState[];
  executing: boolean;
  isDemo: boolean;
  cutoff?: { nextCutoffSgt: string; estimatedSettlementSgt: string; hoursUntilCutoff: number } | null;
  maxLiveTxUsdc?: number;
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

function simText(sim: StepSimulation | undefined, kind: string) {
  if (!sim) return null;
  if (!sim.ok) return <span className="text-red">Revert: {sim.revertReason}</span>;
  if (kind === "approve") return <span className="text-green">approve ok{sim.gasEstimate ? ` · ~${sim.gasEstimate.toLocaleString("en-US")} gas` : ""}</span>;
  if (sim.expectedShares != null)
    return (
      <span className="text-green">
        expected {sim.expectedShares.toFixed(4)} {sim.shareSymbol ?? "shares"}
        {sim.sharePrice ? ` @ ${sim.sharePrice.toFixed(4)} per share` : ""}
        {sim.gasEstimate ? ` · ~${sim.gasEstimate.toLocaleString("en-US")} gas` : ""}
      </span>
    );
  if (sim.requestId) return <span className="text-green">deposit request #{sim.requestId} accepted · would be pending operator settlement</span>;
  return <span className="text-green">ok</span>;
}

export function TxnModal({ prepared, loading, error, steps, executing, isDemo, cutoff, maxLiveTxUsdc, onClose, onExecute, onSimulate }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const s = prepared?.summary;
  const live = prepared?.mode === "onchain";
  const started = steps.some((st) => st.status !== "idle");
  const riskTone = s?.riskLevel === "Low" ? "green" : s?.riskLevel === "Medium" ? "amber" : "red";
  const hasAsync = prepared?.steps.some((st) => st.kind === "requestDeposit") ?? false;
  const chains = [...new Set((prepared?.steps ?? []).map((st) => chainInfo(st.chainId).name))].join(" + ");

  return (
    <>
      <div className="fixed inset-0 z-50 bg-navy/45" onClick={onClose} />
      <div role="dialog" aria-modal className="rise fixed left-1/2 top-1/2 z-[60] max-h-[92vh] w-[min(94vw,600px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[20px] bg-white shadow-modal">
        <div className="flex items-start justify-between px-7 pt-6">
          <div>
            <div className="eyebrow">{loading ? "Preparing" : live ? "Review transaction" : "Review simulation"}</div>
            <div className="mt-1.5 font-display text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">
              {loading ? "Building calldata via IXS MCP…" : prepared ? (live ? "Allocate idle capital to the IXS vault" : "Simulate the allocation against the IXS vault") : "Transaction"}
            </div>
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
            <div className="mx-7 mt-4 flex flex-wrap items-center gap-2">
              <Pill tone={live ? "green" : prepared.rpcKind === "fork" ? "blue" : "amber"} className="h-6 px-2.5 text-[12px]">
                {prepared.label}
              </Pill>
              <span className="text-[12px] text-muted">{live ? `real ${hasAsync ? "deposit request" : "deposit"} on ${chains} · your wallet signs` : "eth_call + state override · nothing is sent"}</span>
            </div>

            <div className="mx-7 mt-3 flex items-center gap-4 rounded-[14px] bg-canvas px-5 py-4">
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
              <Row label="Execution">
                <span className="inline-flex items-center gap-2">
                  <IxsMark size={20} />
                  {s.rail}
                </span>
              </Row>
              {hasAsync && cutoff && (
                <Row label="Settlement">
                  <span className="text-[13px]">
                    async ERC-7540 · next cutoff {cutoff.nextCutoffSgt} (in {cutoff.hoursUntilCutoff} h) · est. settlement {cutoff.estimatedSettlementSgt}
                  </span>
                </Row>
              )}
              <Row label="Network fee">{s.feeUsd > 0 ? `≈ ${fmtUsd(s.feeUsd, { decimals: 2 })}` : "— (simulation)"}</Row>
            </div>

            <div className="mx-7 mt-2 rounded-xl border border-line">
              <div className="border-b border-line-3 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.05em] text-faint">{live ? "Transactions to sign" : "Simulated steps"}</div>
              {prepared.steps.map((st) => {
                const state = steps.find((x) => x.index === st.index);
                const status = state?.status ?? "idle";
                const sim = st.simulation;
                const chain = chainInfo(st.chainId);
                return (
                  <div key={st.index} className="flex items-start gap-3 border-b border-line-3 px-4 py-2.5 text-[13px] last:border-0">
                    <span
                      className={cx(
                        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                        status === "confirmed" || status === "simulated" ? "bg-green text-white" : status === "failed" ? "bg-red text-white" : status === "idle" ? "bg-canvas text-muted" : "bg-blue text-white",
                      )}
                    >
                      {status === "confirmed" || status === "simulated" ? Icons.check : status === "failed" ? Icons.x : status === "idle" ? st.index + 1 : <span className="spinner" style={{ width: 12, height: 12 }} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-ink">{st.description}</div>
                      <div className="text-[11px] leading-relaxed text-faint">
                        {st.mode === "onchain"
                          ? `${chain.name} · ${st.builtBy === "ixs-mcp" ? "calldata by IXS MCP" : "direct vault calldata (IXS MCP unreachable)"} · to ${shortAddress(st.to)}`
                          : `${st.label ?? prepared.label} · eth_call${sim?.overrides.length ? ` with state override (${sim.overrides.join(", ")})` : ""} · to ${shortAddress(st.to)}${sim?.block ? ` · block ${sim.block.toLocaleString("en-US")}` : ""}`}
                        {status === "signing" && " · confirm in your wallet"}
                        {status === "pending" && st.mode === "onchain" && " · waiting for confirmation"}
                        {status === "confirmed" && st.kind === "requestDeposit" && " · Request submitted — pending operator settlement"}
                        {status === "failed" && state?.error && ` · ${state.error}`}
                      </div>
                      {st.mode === "simulated" && <div className="mt-0.5 text-[12px] font-medium">{simText(sim, st.kind)}</div>}
                    </div>
                    {state?.hash && st.mode === "onchain" && (
                      <a href={`${chain.explorer}/tx/${state.hash}`} target="_blank" rel="noreferrer" className="text-blue-deep">
                        {Icons.external}
                      </a>
                    )}
                  </div>
                );
              })}
            </div>

            {prepared.notes.length > 0 && <div className="mx-7 mt-3 rounded-xl bg-amber-tint px-4 py-2.5 text-[12px] text-amber">{prepared.notes.join(" · ")}</div>}

            <div className="mx-7 mt-3 flex items-start gap-3 rounded-xl border border-line px-4 py-3.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-blue text-white">{Icons.check}</span>
              <span className="text-[13px] leading-relaxed text-body">
                {live
                  ? `I understand my wallet will ask me to sign ${prepared.steps.length} transaction${prepared.steps.length > 1 ? "s" : ""} on ${chains} (real USDC into the IX High Yield Bond vault; approvals are for the exact amount; guardrail: at most ${(maxLiveTxUsdc ?? 0).toLocaleString("en-US")} USDC per transaction). ${hasAsync ? "An async request is not a deposit until the IXS operator settles it. " : ""}Vaulto never holds my funds or keys; nothing moves without my signature.`
                  : `${prepared.label}: the approve and deposit calldata built by the IXS MCP run through eth_call with a state override (USDC balance + allowance) against the real IX High Yield Bond vault. No transaction is sent and no funds move.${isDemo ? " Connect a wallet holding" : " Hold"} ≥ ${LIVE_MODE_MIN_USDC} USDC on the vault's chain to switch to Live mode.`}
              </span>
            </div>

            <div className="flex items-center gap-2.5 px-7 pb-6 pt-5">
              <button className="btn btn-danger h-12 rounded-xl px-4 text-[15px]" onClick={onClose} disabled={executing}>
                {started ? "Close" : "Reject"}
              </button>
              {live && (
                <button className="btn btn-soft ml-auto h-12 rounded-xl px-4 text-[15px]" onClick={onSimulate} disabled={executing || started}>
                  Simulate first
                </button>
              )}
              <button className={cx("btn btn-primary h-12 rounded-xl px-5 text-[15px]", !live && "ml-auto")} onClick={onExecute} disabled={executing || started}>
                {executing && <span className="spinner" />}
                {executing ? (live ? "Executing…" : "Simulating…") : live ? "Approve & execute (Live)" : "Approve & execute (Simulate)"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
