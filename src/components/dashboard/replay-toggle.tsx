"use client";

import { useState } from "react";
import { useReplayInfo, useSetReplay } from "@/hooks/use-vaulto";
import { REPLAY_DEFAULT_BLOCK } from "@/lib/chain/config";
import { Pill, cx } from "@/components/ui";

/**
 * Current ↔ Replay switch. Current reads the vaults as they are now; Replay runs SERV + simulations against the BNB
 * mainnet state at a past block where the ixv1 NAV was fresh (archive RPC), so the ALLOCATE path can always be shown.
 * The switch responds at once (optimistic selection) and never waits for the replay list: the default block is known.
 */
export function ReplayToggle() {
  const q = useReplayInfo();
  const set = useSetReplay();
  const [picked, setPicked] = useState<number | null>(null);
  // While a switch is in flight (the mutation also waits for the refetch), show its target (null = Current).
  const target = set.isPending ? (set.variables ?? null) : undefined;
  const active = q.data?.active ?? null;
  const options = q.data?.options?.length ? q.data.options : [{ block: REPLAY_DEFAULT_BLOCK, label: `Block ${REPLAY_DEFAULT_BLOCK} · 24 Sep 2026 15:19 UTC (default)`, default: true }];
  const chosen = picked ?? active?.block ?? q.data?.defaultBlock ?? REPLAY_DEFAULT_BLOCK;
  const shown = target !== undefined ? target : active?.block ?? null;

  const go = (block: number | null) => {
    if (set.isPending || (active?.block ?? null) === block) return;
    set.mutate(block);
  };
  const switching = target !== undefined;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 text-[13px]">
      <span className="font-semibold text-ink">State</span>
      <div className="inline-flex rounded-lg bg-canvas p-1" role="group" aria-label="State shown">
        <button type="button" aria-pressed={shown == null} className={cx("min-h-9 cursor-pointer rounded-md px-4 py-2 font-semibold transition-colors", shown == null ? "bg-white text-ink shadow-sm" : "text-muted hover:bg-white/60 hover:text-ink")} onClick={() => go(null)}>
          Current
        </button>
        <button type="button" aria-pressed={shown != null} className={cx("min-h-9 cursor-pointer rounded-md px-4 py-2 font-semibold transition-colors", shown != null ? "bg-white text-ink shadow-sm" : "text-muted hover:bg-white/60 hover:text-ink")} onClick={() => go(chosen)}>
          Replay
        </button>
      </div>
      <select
        className="h-9 max-w-full rounded-lg border border-line bg-white px-2 text-[12px] text-ink"
        value={chosen}
        onChange={(e) => {
          const n = Number(e.target.value);
          setPicked(n);
          if (shown != null) go(n);
        }}
        aria-label="Replay block"
      >
        {options.map((o) => (
          <option key={o.block} value={o.block}>
            {o.label}
          </option>
        ))}
      </select>
      {switching ? (
        <span className="inline-flex items-center gap-2 text-muted">
          <span className="spinner" />
          {target == null ? "Loading the current state…" : `Loading the state @ block ${target}…`}
        </span>
      ) : active ? (
        <Pill tone="blue">{active.label}</Pill>
      ) : (
        <span className="text-muted">Current: the vaults as they are now (live reads).</span>
      )}
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
