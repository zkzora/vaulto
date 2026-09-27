#!/usr/bin/env node
/**
 * Seed the SERV output cache for the canonical demo views (simulated treasury Acme DAO, Current and Replay @ block
 * 123779792): runs /api/analyze on the deployed app and writes each SERV stage it returns to
 * evidence/serv-cache/<key>.json. Committed seeds let a cold serverless instance reuse that SERV output (labelled
 * "SERV output (cached from <timestamp>)") instead of spending OpenServ credits on identical inputs. A seed only
 * matches while the inputs are identical (same vault state, treasury, policy, block and prompt version).
 *
 * Usage:  BASE_URL=https://vaulto-five.vercel.app node scripts/serv-cache-seed.mjs     (FRESH=1 forces new SERV runs)
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.env.BASE_URL || "https://vaulto-five.vercel.app").replace(/\/$/, "");
const DEMO = "0x7a3f5c1e9b2d4a6f8c0e1d3b5a7c9e2f4b6d9c21";
const VIEWS = [null, 123779792];
const DIR = join("evidence", "serv-cache");
const log = (...a) => console.log("[seed]", ...a);

async function main() {
  mkdirSync(DIR, { recursive: true });
  let spent = 0;
  for (const block of VIEWS) {
    const view = block ? `Replay @ ${block}` : "Current";
    const res = await fetch(`${BASE}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(block ? { cookie: `vaulto_replay=${block}` } : {}) },
      body: JSON.stringify({ address: DEMO, fresh: process.env.FRESH === "1" }),
    });
    const json = await res.json();
    const rec = json.recommendation;
    if (!rec?.serv) throw new Error(`${view}: no SERV status in the analysis (${res.status}): ${JSON.stringify(json).slice(0, 200)}`);
    spent += rec.serv.costUsd;
    log(`${view}: ${rec.serv.status} · spend $${rec.serv.costUsd.toFixed(4)} · ${rec.decisions.map((d) => `${d.strategyId}:${d.verdict}`).join(" ")}`);
    // replace the previous seeds of this view
    for (const f of readdirSync(DIR).filter((x) => x.endsWith(".json"))) {
      try {
        const e = JSON.parse(readFileSync(join(DIR, f), "utf8"));
        if (e.view?.address === DEMO && (e.view?.replayBlock ?? null) === block) rmSync(join(DIR, f));
      } catch {
        /* ignore */
      }
    }
    for (const stage of ["decision", "narrative"]) {
      const run = rec.serv[stage];
      const output = rec.trace?.[stage]?.output;
      if (!run || !output || (run.status !== "fresh" && run.status !== "cached")) {
        log(`  ${stage}: ${run?.status ?? "missing"} — not seeded${run?.error ? ` (${run.error})` : ""}`);
        continue;
      }
      const entry = { key: run.key, stage, promptVersion: run.promptVersion, model: run.model, createdAt: run.at, output, usage: run.usage, view: { address: DEMO, replayBlock: block } };
      writeFileSync(join(DIR, `${run.key}.json`), JSON.stringify(entry, null, 2) + "\n");
      log(`  ${stage}: ${run.status} from ${run.at} → ${DIR}/${run.key}.json${run.usage ? ` (original cost $${run.usage.costUsd.toFixed(4)}, ${run.usage.promptTokens} in / ${run.usage.completionTokens} out tokens)` : ""}`);
    }
  }
  log(`OpenServ spend of this seeding run ≈ $${spent.toFixed(4)}`);
}

main().catch((e) => {
  console.error("[seed] failed:", e.message);
  process.exitCode = 1;
});
