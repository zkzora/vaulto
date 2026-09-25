#!/usr/bin/env node
/**
 * Vaulto · NAV / deposit-limit watcher (runs on a schedule in GitHub Actions, or by hand).
 *
 * Reads maxDeposit(probe), priceUpdatedAt() and navStalenessThreshold() of the open IXS vaults straight from the
 * chain (plain JSON-RPC, no dependencies) and reports when a recording window opens: the deposit limit is above 0
 * (ixv1 reopens after a NAV refresh) or the NAV timestamp changed since the last report.
 *
 * Notifications (each only once per vault + NAV timestamp):
 *  - a GitHub issue labelled "nav-watch" in this repository (GitHub emails the repo owner), when GH_TOKEN is set;
 *  - a POST to NOTIFY_WEBHOOK_URL (Discord / Slack / ntfy style JSON: {content, text}), when that secret is set;
 *  - always a log line.
 *
 * Usage: node scripts/nav-watch.mjs            (DRY_RUN=1 prints without notifying)
 */
import { execFileSync } from "node:child_process";

const PROBE = "1111111111111111111111111111111111111111";
const VAULTS = [
  { name: "ixv1 · BNB Chain (open, sync ERC-4626)", chainId: 56, rpc: process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org", address: "0xc975a3EeF2e49F8eDdEf585340C43f15300fCB82", decimals: 18 },
  { name: "IXHYB · Avalanche (open, async ERC-7540)", chainId: 43114, rpc: process.env.AVAX_RPC_URL || "https://api.avax.network/ext/bc/C/rpc", address: "0xaD01573b459805E3954398796203d830B57A8bD9", decimals: 6 },
];
const SEL = { maxDeposit: "0x402d267d", priceUpdatedAt: "0xb11c4eec", navStalenessThreshold: "0x41f9e78e" };
const DRY = /^(1|true|yes)$/i.test(process.env.DRY_RUN || "");

async function call(rpc, to, data) {
  const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }) });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return BigInt(j.result);
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", env: process.env }).trim();
}

async function main() {
  const now = Date.now() / 1000;
  const repo = process.env.GITHUB_REPOSITORY;
  const canIssue = Boolean(process.env.GH_TOKEN && repo);
  if (canIssue && !DRY) {
    try {
      gh(["label", "create", "nav-watch", "--repo", repo, "--color", "5B8DEF", "--description", "IXS vault NAV / deposit-limit watcher", "--force"]);
    } catch {
      // label exists or no permission; issue creation below reports errors
    }
  }
  for (const v of VAULTS) {
    const [limit, updatedAt, threshold] = await Promise.all([
      call(v.rpc, v.address, SEL.maxDeposit + PROBE.padStart(64, "0")),
      call(v.rpc, v.address, SEL.priceUpdatedAt),
      call(v.rpc, v.address, SEL.navStalenessThreshold).catch(() => null),
    ]);
    const unlimited = limit > 10n ** 70n;
    const open = limit > 0n;
    const navIso = new Date(Number(updatedAt) * 1000).toISOString();
    const ageH = (now - Number(updatedAt)) / 3600;
    const thH = threshold != null ? Number(threshold) / 3600 : null;
    const closesAt = thH != null ? new Date((Number(updatedAt) + Number(threshold)) * 1000).toISOString() : null;
    const limitText = unlimited ? "unlimited" : `${Number(limit) / 10 ** v.decimals} USDC`;
    console.log(`[nav-watch] ${v.name}: maxDeposit ${limitText} · NAV ${navIso} (${ageH.toFixed(1)} h old${thH != null ? `, threshold ${thH} h` : ""}) · ${open ? "OPEN" : "closed"}`);
    if (!open) continue;

    const key = `${v.address.slice(0, 10)} NAV ${navIso}`;
    const title = `Recording window open: ${v.name.split(" ·")[0]} accepts deposits (NAV ${navIso.slice(0, 16).replace("T", " ")} UTC) [${key}]`;
    const body = [
      `**${v.name}** is accepting deposits again.`,
      "",
      `- maxDeposit(new wallet): ${limitText}`,
      `- NAV updated: ${navIso} (${ageH.toFixed(1)} h ago)`,
      thH != null ? `- Contract navStalenessThreshold(): ${thH} h, so the window closes around **${closesAt}** unless IXS refreshes the NAV again` : "",
      "",
      "Good moment to record the ALLOCATE → Simulate scene on the current state, and to run:",
      "```",
      "AMOUNT=104 REDEEM=1 npm run fork:demo",
      "npm run evidence:snapshot",
      "```",
      "",
      `Checked at ${new Date().toISOString()} by scripts/nav-watch.mjs.`,
    ].filter((l) => l !== "").join("\n");

    if (DRY) {
      console.log(`[nav-watch] DRY_RUN: would notify "${title}"`);
      continue;
    }
    let already = false;
    if (canIssue) {
      const found = gh(["issue", "list", "--repo", repo, "--label", "nav-watch", "--state", "all", "--search", `"${key}" in:title`, "--json", "number", "--jq", "length"]);
      already = Number(found) > 0;
      if (!already) {
        const url = gh(["issue", "create", "--repo", repo, "--label", "nav-watch", "--title", title, "--body", body]);
        console.log(`[nav-watch] issue created: ${url}`);
      } else console.log("[nav-watch] already reported for this NAV timestamp");
    }
    if (process.env.NOTIFY_WEBHOOK_URL && !already) {
      const text = `${title}\n${body}`;
      const res = await fetch(process.env.NOTIFY_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: text.slice(0, 1900), text }) });
      console.log(`[nav-watch] webhook ${res.status}`);
    }
  }
}

main().catch((e) => {
  console.error("[nav-watch] failed:", e.message ?? e);
  process.exitCode = 1;
});
