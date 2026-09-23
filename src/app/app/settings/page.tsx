"use client";

import { useState } from "react";
import { useVaultoAccount } from "@/hooks/use-account";
import { useResetDemo, useSettings, useUpdateSettings } from "@/hooks/use-vaulto";
import { CHAIN_NAME } from "@/lib/chain/config";
import { shortAddress } from "@/lib/format";
import type { RiskProfile, UserPatch } from "@/lib/types";
import { Card, CardTitle, ErrorState, Pill, Skeleton, cx } from "@/components/ui";

const PROFILES: { value: RiskProfile; label: string; body: string }[] = [
  { value: "Conservative", label: "Conservative", body: "Only vaults scoring 90+, larger liquidity buffer." },
  { value: "Balanced", label: "Balanced", body: "Default. Liquidity floor first, then best risk-adjusted yield." },
  { value: "Growth", label: "Growth", body: "Higher target allocation to IXS strategies." },
];

export default function SettingsPage() {
  const q = useSettings();
  const account = useVaultoAccount();
  const update = useUpdateSettings();
  const reset = useResetDemo();
  const [draft, setDraft] = useState<UserPatch | null>(null);
  const [saved, setSaved] = useState(false);

  if (q.isError) return <ErrorState message={q.error.message} retry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const { system, user: u } = q.data;
  const form: UserPatch = draft ?? {
    daoName: u.daoName,
    treasuryGoal: u.treasuryGoal,
    riskProfile: u.riskProfile,
    liquidityFloorPct: u.liquidityFloorPct,
    maxAssetExposurePct: u.maxAssetExposurePct,
    minVaultRiskScore: u.minVaultRiskScore,
    monthlyBurnUsd: u.monthlyBurnUsd,
    demoMode: u.demoMode,
  };
  const setForm = setDraft;

  const set = <K extends keyof UserPatch>(k: K, v: UserPatch[K]) => setDraft({ ...form, [k]: v });
  const save = async () => {
    await update.mutateAsync(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="grid content-start gap-5">
      <div>
        <div className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">Settings</div>
        <div className="mt-1 text-[14px] text-muted">Treasury objectives and the risk policy every agent must respect.</div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="grid gap-5">
          <Card>
            <CardTitle>Treasury</CardTitle>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-[13px] font-medium text-muted">
                Organization name
                <input className="field" value={form.daoName ?? ""} onChange={(e) => set("daoName", e.target.value)} />
              </label>
              <label className="grid gap-1.5 text-[13px] font-medium text-muted">
                Monthly burn (USD)
                <input className="field" type="number" min={0} step={1000} value={form.monthlyBurnUsd ?? 0} onChange={(e) => set("monthlyBurnUsd", Number(e.target.value))} />
              </label>
              <label className="grid gap-1.5 text-[13px] font-medium text-muted sm:col-span-2">
                Treasury goal
                <input className="field" value={form.treasuryGoal ?? ""} onChange={(e) => set("treasuryGoal", e.target.value)} placeholder="Preserve runway, earn on idle capital" />
              </label>
            </div>
          </Card>

          <Card>
            <CardTitle>Risk policy</CardTitle>
            <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
              {PROFILES.map((p) => (
                <button key={p.value} onClick={() => set("riskProfile", p.value)} className={cx("rounded-xl p-4 text-left transition-colors", form.riskProfile === p.value ? "border-[1.5px] border-blue bg-tint-2" : "border border-line hover:bg-canvas")}>
                  <div className="text-[14px] font-semibold text-ink">{p.label}</div>
                  <div className="mt-1 text-[12px] leading-[1.5] text-muted">{p.body}</div>
                </button>
              ))}
            </div>
            <div className="mt-5 grid gap-5 sm:grid-cols-3">
              {[
                ["liquidityFloorPct", "Liquidity floor", "% of treasury kept liquid", 0, 90],
                ["maxAssetExposurePct", "Max asset exposure", "% in any single asset", 10, 100],
                ["minVaultRiskScore", "Min vault risk score", "0–100, higher is safer", 0, 100],
              ].map(([key, label, sub, min, max]) => (
                <label key={key as string} className="grid gap-1.5 text-[13px] font-medium text-muted">
                  <span className="flex justify-between">
                    {label}
                    <b className="text-ink">{form[key as "liquidityFloorPct"]}{key === "minVaultRiskScore" ? "" : "%"}</b>
                  </span>
                  <input type="range" min={min as number} max={max as number} value={form[key as "liquidityFloorPct"] ?? 0} onChange={(e) => set(key as "liquidityFloorPct", Number(e.target.value))} className="accent-blue" />
                  <span className="text-[11px] text-faint">{sub}</span>
                </label>
              ))}
            </div>
          </Card>

          <Card>
            <CardTitle action={<Pill tone={form.demoMode ? "amber" : "green"}>{form.demoMode ? "Simulated layer ON" : "Real balances only"}</Pill>}>Demo layer</CardTitle>
            <label className="mt-3 flex items-start gap-3">
              <input type="checkbox" checked={Boolean(form.demoMode)} onChange={(e) => set("demoMode", e.target.checked)} className="mt-1 h-4 w-4 accent-blue" />
              <span className="text-[13px] leading-[1.5] text-body">
                <b className="text-ink">Add the simulated Acme DAO treasury (≈ $2.8M of fake BTC, USDC and T-bills) on top of my real wallet.</b> Meant for walkthroughs without test funds. Leave it off to see only what your wallet actually holds on {CHAIN_NAME}; on-chain balances, faucet assets and vault positions are always real either way.
              </span>
            </label>
            {form.demoMode && account.isWallet && (
              <div className="mt-3 rounded-xl bg-amber-tint px-3.5 py-2.5 text-[12px] text-amber">
                The totals on Home, Portfolio and Strategy will include simulated capital and simulated positions while this is on.
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <button className="btn btn-primary" disabled={update.isPending} onClick={save}>
                {update.isPending ? "Saving…" : saved ? "Saved" : "Save settings"}
              </button>
              <button
                className="btn btn-ghost"
                disabled={reset.isPending}
                onClick={async () => {
                  await reset.mutateAsync();
                  setForm(null);
                }}
              >
                Reset demo state
              </button>
              {update.isError && <span className="text-[12px] text-red">{update.error.message}</span>}
            </div>
          </Card>
        </div>

        <div className="grid gap-5">
          <Card>
            <CardTitle>System status</CardTitle>
            <div className="mt-4 grid gap-3 text-[13px]">
              {[
                ["Wallet", account.isWallet ? `${account.connector ?? "Wallet"} · ${shortAddress(account.address)}` : `Demo address · ${shortAddress(account.address)}`, account.isWallet ? "green" : "amber", account.isWallet ? "Connected" : "Demo"],
                ["Network", `${system.network} (chain ${system.chainId})`, account.isWallet && account.chainId !== system.chainId ? "red" : "green", account.isWallet && account.chainId !== system.chainId ? "Switch network" : "Ready"],
                [
                  "OpenServ reasoning",
                  system.openserv
                    ? system.openservMode === "platform"
                      ? "Tasks run on the OpenServ runtime (agent key + workspace configured)"
                      : `OpenServ Inference API · ${system.openservModel}`
                    : `OPENSERV_API_KEY ${system.openservKey ? "set" : "missing"}${system.openservMode === "platform" ? ` · OPENSERV_WORKSPACE_ID ${system.openservWorkspace ? "set" : "missing"}` : ""} · local reasoning engine in use`,
                  system.openserv ? "green" : "amber",
                  system.openserv ? "Live" : "Fallback",
                ],
                ["IXS adapter", "api-dev-v2.ixs.finance · MCP + Vault API", "green", "Connected"],
                [
                  "Testnet faucet",
                  system.faucet ? `Sends ${CHAIN_NAME} gas and forwards IXS test USDC while the faucet wallet holds some` : "FAUCET_PRIVATE_KEY missing",
                  system.faucet ? "green" : "amber",
                  system.faucet ? "Ready" : "Missing",
                ],
                ["Database", system.database === "postgres" ? "PostgreSQL via Prisma" : "JSON file store (.data/) · set DATABASE_URL for Postgres", system.database === "postgres" ? "green" : "muted", system.database === "postgres" ? "Postgres" : "File"],
              ].map(([k, v, tone, label]) => (
                <div key={k as string} className="flex items-center justify-between gap-3 border-b border-line-3 pb-3 last:border-0 last:pb-0">
                  <div>
                    <div className="font-semibold text-ink">{k as string}</div>
                    <div className="text-[12px] text-muted">{v as string}</div>
                  </div>
                  <Pill tone={tone as "green"}>{label as string}</Pill>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardTitle>Security</CardTitle>
            <ul className="mt-3 grid gap-2 text-[13px] leading-[1.5] text-body">
              <li>• No unrestricted autonomous transfers. OpenServ proposes; it never executes.</li>
              <li>• Every transaction shows amount, destination, expected outcome and risk before you sign.</li>
              <li>• Vaulto holds no keys. Your wallet signs on {CHAIN_NAME}; IXS MCP and the adapter build calldata only.</li>
              <li>• Reasoning, confidence and transaction hashes are logged in Activity.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
