#!/usr/bin/env node
/**
 * Vaulto · evidence snapshot of a public demo run.
 *
 * Runs the judge flow against a deployment (default: the public one) and writes everything it returned to
 * evidence/snapshot-<date>.json, which /evidence shows as a fallback when a fresh serverless instance has no call log:
 *  - SERV verdict per vault (input facts + raw output), pre-flight per vault (limit, NAV timestamp, block), memo;
 *  - "Approve & execute (Simulate)" for the demo leg when SERV allocates (eth_call + state override, expected shares);
 *  - deposit and redeem simulations from a fresh, empty wallet (no balance, no allowance);
 *  - the mainnet-fork runs in evidence/fork-*.json;
 *  - the dated IXS and judge statements and the call log the deployment recorded during the run.
 * Nothing here signs or sends a transaction.
 *
 * Usage:  node scripts/evidence-snapshot.mjs            (BASE_URL=https://vaulto-five.vercel.app, OUT=evidence/snapshot-YYYY-MM-DD.json)
 */
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.env.BASE_URL || "https://vaulto-five.vercel.app").replace(/\/$/, "");
const DEMO = "0x7a3f5c1e9b2d4a6f8c0e1d3b5a7c9e2f4b6d9c21";
const EMPTY = `0x${randomBytes(20).toString("hex")}`;
const started = new Date();
const OUT = process.env.OUT || join("evidence", `snapshot-${started.toISOString().slice(0, 10)}.json`);
const log = (...a) => console.error("[snapshot]", ...a);

async function call(method, path, body) {
  const t = Date.now();
  const res = await fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  log(`${method} ${path} → ${res.status} in ${Date.now() - t} ms`);
  return { status: res.status, json };
}

const fmt = (n, d = 4) => (n == null ? "?" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d }));

function depositSummary(r) {
  if (r.verdict !== "allocate") return `${r.verdict.toUpperCase()}: ${r.note ?? "pre-flight did not pass"} Nothing built. ${(r.preflight?.checks ?? []).filter((c) => !c.ok && c.severity !== "info").map((c) => `${c.label}: ${c.value}`).join("; ")}`;
  const dep = (r.steps ?? []).find((s) => s.kind !== "approve");
  const sim = dep?.simulation;
  if (!sim) return "No simulation result returned.";
  return sim.ok
    ? `${r.label}: approve + ${dep.kind} built by ${r.builtBy === "ixs-mcp" ? "the IXS MCP" : r.builtBy}; eth_call at block ${sim.block} returns ${fmt(sim.expectedShares)} ${sim.shareSymbol ?? "shares"} for ${fmt(r.amount, 2)} ${r.asset} (previewDeposit ${fmt(sim.previewShares)}), gas ≈ ${fmt(sim.gasEstimate, 0)}. Overrides: ${(sim.overrides ?? []).join(", ") || "none"}.`
    : `${r.label}: the vault reverts: ${sim.revertReason}.`;
}

function redeemSummary(r) {
  const s = r.redeem;
  if (!s) return "No redeem simulation returned.";
  return s.ok
    ? `${r.label}: requestRedeem of ${fmt(s.shares)} shares queues request #${s.requestId ?? "?"} (block ${s.block}); previewRedeem ${fmt(s.netAssets)} USDC net (gross ${fmt(s.grossAssets)}, fee ${fmt(s.feeAssets)}), above the ${r.minRedeemUsd} USDC minimum. Path: ${s.path}.`
    : `${r.label}: requestRedeem of ${fmt(s.shares)} shares reverts: ${s.revertReason}${s.netAssets != null ? ` (previewRedeem ${fmt(s.netAssets)} USDC net vs minimum ${r.minRedeemUsd} USDC)` : ""}.`;
}

async function main() {
  log(`base ${BASE} · demo ${DEMO} · empty wallet ${EMPTY}`);
  const settings = await call("GET", `/api/settings?address=${DEMO}&ping=1`);
  const analyze = await call("POST", "/api/analyze", { address: DEMO });
  const rec = analyze.json.recommendation;
  if (!rec) throw new Error(`analysis failed: ${JSON.stringify(analyze.json).slice(0, 300)}`);
  log(`SERV ${rec.reasoningSource} (${rec.reasoningModel}) · ${rec.decisions.map((d) => `${d.strategyId}:${d.verdict}`).join(" ")} · overrides ${rec.validatorOverrides?.length ?? 0}`);

  const evidenceBefore = await call("GET", "/api/evidence");
  const ixv1 = (evidenceBefore.json.vaults ?? []).find((v) => v.symbol === "ixv1");
  const price = ixv1?.pricePerShare ?? 1.091;

  const simulations = [];
  if (rec.legs?.length) {
    const prep = await call("POST", "/api/execute", { address: DEMO, recommendationId: rec.id, simulate: true, recommendation: rec });
    const p = prep.json.prepared;
    const dep = p?.steps?.find((s) => s.kind !== "approve");
    simulations.push({
      label: `Approve & execute (Simulate) · SERV leg ${rec.legs.map((l) => `${fmt(l.amount, 2)} ${l.asset} → ${l.vaultName}`).join(" + ")} · simulated treasury`,
      ok: Boolean(dep?.simulation?.ok),
      summary: dep?.simulation ? (dep.simulation.ok ? `${p.label}: eth_call at block ${dep.simulation.block} returns ${fmt(dep.simulation.expectedShares)} ${dep.simulation.shareSymbol ?? "shares"} (previewDeposit ${fmt(dep.simulation.previewShares)}) for ${fmt(dep.amount, 2)} ${dep.asset}, gas ≈ ${fmt(dep.simulation.gasEstimate, 0)}. Nothing sent.` : `${p.label}: reverts: ${dep.simulation.revertReason}`) : prep.json.error ?? "no prepared transaction",
      request: { endpoint: "POST /api/execute", address: DEMO, recommendationId: rec.id, simulate: true },
      response: p ? { label: p.label, executionMode: p.executionMode, notes: p.notes, steps: p.steps.map((s) => ({ kind: s.kind, to: s.to, builtBy: s.builtBy, amount: s.amount, asset: s.asset, dataPrefix: s.data.slice(0, 10), simulation: s.simulation })) } : prep.json,
    });
  }
  for (const [strategyId, amount] of [["ixhyb-bnb", 104], ["ixhyb-avax", 100]]) {
    const r = await call("POST", "/api/simulate", { address: EMPTY, strategyId, amount });
    simulations.push({ label: `Simulate deposit · ${amount} USDC → ${strategyId} · empty wallet`, ok: r.json.verdict === "allocate" && Boolean(r.json.steps?.find((s) => s.kind !== "approve")?.simulation?.ok), summary: r.json.error ? `error: ${r.json.error}` : depositSummary(r.json), request: { endpoint: "POST /api/simulate", address: EMPTY, strategyId, amount }, response: r.json });
  }
  const shares104 = Math.ceil((104 / price) * 1e4) / 1e4;
  for (const shares of [91.6513, shares104]) {
    const r = await call("POST", "/api/simulate", { address: EMPTY, strategyId: "ixhyb-bnb", action: "redeem", shares });
    simulations.push({ label: `Simulate redeem · ${shares} ixv1${shares === 91.6513 ? " (the shares of a 100 USDC deposit)" : " (the shares of a 104 USDC deposit)"} · empty wallet with a share-balance override`, ok: Boolean(r.json.redeem?.ok), summary: r.json.error ? `error: ${r.json.error}` : redeemSummary(r.json), request: { endpoint: "POST /api/simulate", address: EMPTY, strategyId: "ixhyb-bnb", action: "redeem", shares }, response: r.json });
  }

  const evidence = await call("GET", "/api/evidence");
  const e = evidence.json;
  const since = started.getTime() - 60_000;
  const runLog = (e.log ?? []).filter((x) => x.origin !== "snapshot" && Date.parse(x.at) >= since).map(({ origin, ...x }) => x).slice(0, 200);
  const forkRuns = readdirSync("evidence").filter((f) => f.startsWith("fork-") && f.endsWith(".json")).sort().map((f) => ({ file: `evidence/${f}`, ...JSON.parse(readFileSync(join("evidence", f), "utf8")) }));

  const allocate = rec.decisions.filter((d) => d.verdict === "allocate");
  const catalog = (await call("GET", "/api/vaults")).json.strategies ?? [];
  const vaultName = (id) => catalog.find((x) => x.id === id)?.vaultName ?? id;
  const snapshot = {
    kind: "vaulto-evidence-snapshot",
    version: 1,
    capturedAt: started.toISOString(),
    finishedAt: new Date().toISOString(),
    baseUrl: BASE,
    deployment: e.deployment,
    submission: e.submission,
    note: allocate.length
      ? undefined
      : "At capture time no IXS vault accepted deposits: both open vaults returned maxDeposit 0 (NAV older than the contract's staleness threshold, the NAV-staleness effect IXS described on 24 Sep 2026), so SERV deferred them and nothing was built. Simulations and fork runs from when the NAV was fresh are listed below.",
    openserv: { ping: settings.json.openservPing, model: settings.json.system?.openservModel, mode: settings.json.system?.openservMode },
    system: settings.json.system,
    statements: e.ixsStatements,
    registry: { source: e.registrySource, vaults: e.vaults },
    cutoff: e.cutoff,
    watch: e.watch,
    analysis: {
      wallet: DEMO,
      treasury: "Simulated treasury (Acme DAO)",
      recommendationId: rec.id,
      createdAt: rec.createdAt,
      durationMs: rec.durationMs,
      reasoningSource: rec.reasoningSource,
      reasoningModel: rec.reasoningModel,
      confidence: rec.confidence,
      title: rec.title,
      headline: rec.headline,
      summary: rec.summary,
      decisions: rec.decisions.map((d) => ({ ...d, vault: vaultName(d.strategyId) })),
      legs: rec.legs,
      validatorOverrides: rec.validatorOverrides ?? [],
      guardrails: rec.guardrails,
      preflights: Object.fromEntries(
        Object.entries(rec.preflights ?? {}).map(([id, p]) => [id, { verdict: p.verdict, chainId: p.chainId, blockNumber: p.blockNumber, checkedAt: p.checkedAt, depositLimitUsd: p.depositLimitUsd, depositLimitUnlimited: p.depositLimitUnlimited, navUpdatedAt: p.navUpdatedAt, navAgeHours: p.navAgeHours, navLastChangeTx: p.navLastChangeTx, navLastChangeBlock: p.navLastChangeBlock, minDepositUsd: p.minDepositUsd, minLiveDepositUsd: p.minLiveDepositUsd, whitelisted: p.whitelisted, settlement: p.settlement, checks: p.checks }]),
      ),
      rejected: rec.rejected,
      deferred: rec.deferred,
      memo: rec.memo,
      trace: rec.trace,
    },
    simulations,
    forkRuns,
    log: runLog,
  };
  writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + "\n");
  log(`wrote ${OUT} · ${simulations.length} simulations · ${forkRuns.length} fork runs · ${runLog.length} log entries`);
  for (const s of simulations) log(`${s.ok ? "ok " : "-- "} ${s.label}: ${s.summary.slice(0, 220)}`);
}

main().catch((e) => {
  console.error("[snapshot] failed:", e.message ?? e);
  process.exit(1);
});
