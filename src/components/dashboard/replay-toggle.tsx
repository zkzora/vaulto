"use client";

import { useState } from "react";
import { useReplayInfo, useSetReplay } from "@/hooks/use-vaulto";
import { Pill, cx } from "@/components/ui";

/**
 * Current ↔ Replay switch. Current reads the vaults as they are now; Replay runs SERV + simulations against the BNB
 * mainnet state at a past block where the ixv1 NAV was fresh (archive RPC), so the ALLOCATE path can always be shown.
 */
export function ReplayToggle() {
  const q = useReplayInfo();
  const set = useSetReplay();
  const [picked, setPicked] = useState<number | null>(null);
  const active = q.data?.active ?? null;
  const options = q.data?.options ?? [];
  const chosen = picked ?? active?.block ?? q.data?.defaultBlock ?? null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 text-[13px]">
      <span className="font-semibold text-ink">State</span>
      <div className="inline-flex rounded-lg bg-canvas p-1" role="group" aria-label="State shown">
        <button className={cx("rounded-md px-3 py-1.5 font-semibold", !active ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink")} disabled={set.isPending || !active} onClick={() => set.mutate(null)}>
          Current
        </button>
        <button className={cx("rounded-md px-3 py-1.5 font-semibold", active ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink")} disabled={set.isPending || chosen == null} onClick={() => chosen != null && set.mutate(chosen)}>
          Replay
        </button>
      </div>
      <select
        className="h-9 max-w-full rounded-lg border border-line bg-white px-2 text-[12px] text-ink"
        value={chosen ?? ""}
        onChange={(e) => {
          const n = Number(e.target.value);
          setPicked(n);
          if (active) set.mutate(n);
        }}
        aria-label="Replay block"
      >
        {options.map((o) => (
          <option key={o.block} value={o.block}>
            {o.label}
          </option>
        ))}
      </select>
      {set.isPending ? <span className="spinner" /> : active ? <Pill tone="blue">{active.label}</Pill> : <span className="text-muted">Current: the vaults as they are now (live reads).</span>}
      {set.isError && <span className="text-[12px] text-red">{set.error.message}</span>}
    </div>
  );
}

/** Thin bar under the topbar on every app page while Replay is on. */
export function ReplayBanner() {
  const q = useReplayInfo();
  const set = useSetReplay();
  const active = q.data?.active;
  if (!active) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-tint px-6 py-2 text-[13px] text-blue-deep">
      <span>
        <b>{active.label}</b> · {new Date(active.iso).toISOString().slice(0, 16).replace("T", " ")} UTC · SERV analysis and simulations read that past block through an archive RPC (Avalanche at block {active.avaxBlock ?? "?"}). Nothing is sent.
      </span>
      <button className="btn btn-soft h-8 text-[12px]" disabled={set.isPending} onClick={() => set.mutate(null)}>
        Back to current state
      </button>
    </div>
  );
}
