#!/usr/bin/env node
/**
 * Vaulto · Mainnet fork demo (for the video).
 *
 * For every IX High Yield Bond vault the IXS Vault API lists on the forked chain:
 *  1. Anvil forks the chain (BNB mainnet by default; Avalanche with FORK_CHAIN=43114).
 *  2. asset() / decimals() are read from the vault contract; maxDeposit(demo) is the pre-flight deposit limit.
 *  3. Limit 0 → the vault is reported as "DEFER — temporarily paused, waiting NAV refresh" (per IXS, 24 Sep 2026)
 *     and nothing is built. Not whitelisted → REJECT.
 *  4. Otherwise a large USDC holder is impersonated to fund the demo wallet, the IXS MCP builds approve + deposit /
 *     requestDeposit, both are sent from the demo wallet and the outcome is read back:
 *     - sync ERC-4626: shares minted in the deposit transaction;
 *     - async ERC-7540: "Request submitted — pending operator settlement (fork: IXS operator not present)".
 *
 * Everything here runs against the fork only. Labels: "Mainnet fork (Anvil)".
 *
 * Usage:  node --env-file=.env scripts/fork-demo.mjs
 * Env:    FORK_CHAIN (56 | 43114), FORK_RPC, ANVIL_BIN, ANVIL_PORT, AMOUNT (100), KEEP=1 (leave Anvil running so the
 *         web app can use RPC_URL / AVAX_RPC_URL = http://127.0.0.1:<port>), DEMO_PRIVATE_KEY / DEMO_WALLET, VAULT_ROUTE_ID.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, formatUnits, http, parseAbi, parseUnits } from "viem";
import { avalanche, bsc } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const FORK_CHAIN = Number(process.env.FORK_CHAIN || 56);
const CHAINS = {
  56: { chain: bsc, name: "BNB Chain", rpc: "https://bsc-dataseed.bnbchain.org", port: 8545, whales: ["0xF977814e90dA44bFA03b6295A0616a897441aceC", "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3", "0xe2fc31F816A9b94326492132018C3aEcC4a93aE1", "0x0D0707963952f2fBA59dD06f2b425ace40b492Fe", "0xD3a22590f8243f8E83Ac230D1842C9Af0404C4A1", "0x5a52E96BAcdaBb82fd05763E25335261B270Efcb"] },
  43114: { chain: avalanche, name: "Avalanche C-Chain", rpc: "https://api.avax.network/ext/bc/C/rpc", port: 8546, whales: ["0x9f8c163cBA728e99993ABe7495F06c0A3c8Ac8b9", "0xF977814e90dA44bFA03b6295A0616a897441aceC", "0x4aeFa39caEAdD662aE31ab0CE7c8C2c9c0a013E8", "0x0e0B5a4C6b4c4d6f2a3d4b5c6d7e8f9a0b1c2d3e"] },
};
const C = CHAINS[FORK_CHAIN];
if (!C) throw new Error(`unsupported FORK_CHAIN ${FORK_CHAIN}`);
const FORK_RPC = process.env.FORK_RPC || C.rpc;
const PORT = Number(process.env.ANVIL_PORT || C.port);
const LOCAL = `http://127.0.0.1:${PORT}`;
const API = (process.env.IXS_API_BASE_URL || "https://api-v2.ixs.finance").replace(/\/$/, "");
const MCP = process.env.IXS_MCP_URL || "https://api-v2.ixs.finance/mcp";
const AMOUNT = process.env.AMOUNT || "100";
const KEEP = /^(1|true|yes)$/i.test(process.env.KEEP || "");
// Anvil's well-known test account #0 (never holds real value).
const DEMO_KEY = process.env.DEMO_PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const demoAccount = privateKeyToAccount(DEMO_KEY);
const DEMO_WALLET = process.env.DEMO_WALLET || demoAccount.address;
const IMPERSONATE_DEMO = DEMO_WALLET.toLowerCase() !== demoAccount.address.toLowerCase();
const UINT_MAX = 2n ** 256n - 1n;

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
]);
const vaultAbi = parseAbi([
  "function asset() view returns (address)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function totalAssets() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function maxDeposit(address) view returns (uint256)",
  "function paused() view returns (bool)",
  "function whitelistEnabled() view returns (bool)",
  "function whitelist(address) view returns (bool)",
  "function feeBps() view returns (uint256)",
  "function redeemFeeBps() view returns (uint256)",
  "function deposit(uint256,address) returns (uint256)",
  "function requestDeposit(uint256,address,address) returns (uint256)",
  "function pendingDepositRequest(uint256,address) view returns (uint256)",
  "function claimableDepositRequest(uint256,address) view returns (uint256)",
  "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
  "event DepositRequest(address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 assets)",
]);

const log = (...a) => console.log("[fork-demo]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function anvilBin() {
  if (process.env.ANVIL_BIN) return process.env.ANVIL_BIN;
  const home = join(homedir(), ".foundry", "bin");
  for (const name of ["anvil.exe", "anvil"]) {
    const p = join(home, name);
    if (existsSync(p)) return p;
  }
  return "anvil";
}

async function rpc(method, params = []) {
  const res = await fetch(LOCAL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

async function mcp(name, args) {
  const res = await fetch(MCP, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  const json = JSON.parse(line ? line.slice(5) : text);
  if (json.error) throw new Error(`MCP ${name}: ${json.error.message}`);
  const r = json.result;
  if (r?.isError) throw new Error(`MCP ${name}: ${r.content?.[0]?.text ?? "error"}`);
  if (r?.structuredContent) return r.structuredContent;
  try {
    return JSON.parse(r?.content?.[0]?.text ?? "{}");
  } catch {
    return r;
  }
}

async function main() {
  const api = await (await fetch(`${API}/vaults`)).json();
  let items = (api.items ?? []).filter((v) => v.chainId === FORK_CHAIN);
  if (process.env.VAULT_ROUTE_ID) items = items.filter((v) => v.routeId === process.env.VAULT_ROUTE_ID);
  if (!items.length) throw new Error(`no ${C.name} vault on the IXS API`);
  log(`${items.length} vault(s) on ${C.name} from the IXS Vault API: ${items.map((v) => `${v.symbol} ${v.contractAddress}${v.requiresWhitelist ? " (whitelist)" : ""}`).join(", ")}`);

  const bin = anvilBin();
  log(`starting ${bin} --fork-url ${FORK_RPC} --chain-id ${FORK_CHAIN} --port ${PORT}`);
  const anvil = spawn(bin, ["--fork-url", FORK_RPC, "--chain-id", String(FORK_CHAIN), "--port", String(PORT), "--silent"], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  anvil.stderr.on("data", (d) => (stderr += d.toString()));
  const stop = () => {
    if (!anvil.killed) anvil.kill();
  };
  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    try {
      up = Number(await rpc("eth_chainId")) === FORK_CHAIN;
    } catch {
      await sleep(500);
    }
  }
  if (!up) {
    stop();
    throw new Error(`anvil did not come up: ${stderr.slice(-600)}`);
  }
  const pub = createPublicClient({ chain: C.chain, transport: http(LOCAL) });
  const forkBlock = await pub.getBlockNumber();
  log(`Mainnet fork (Anvil) ready at ${LOCAL} · ${C.name} forked at block ${forkBlock}`);
  const wallet = createWalletClient({ account: demoAccount, chain: C.chain, transport: http(LOCAL) });
  await rpc("anvil_setBalance", [DEMO_WALLET, "0x8AC7230489E80000"]); // 10 native for gas
  const results = [];

  try {
    for (const v of items) {
      const VAULT = v.contractAddress;
      const entry = { label: "Mainnet fork (Anvil)", chainId: FORK_CHAIN, chain: C.name, forkBlock: Number(forkBlock), vault: { name: v.name, symbol: v.symbol, address: VAULT, routeId: v.routeId, requiresWhitelist: v.requiresWhitelist }, demoWallet: DEMO_WALLET };
      results.push(entry);
      // Pre-flight from the contract: asset(), decimals(), maxDeposit(demo), whitelist, pause.
      const ASSET = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "asset" });
      const [assetDecimals, assetSymbol, shareDecimals, shareSymbol, maxDep, paused] = await Promise.all([
        pub.readContract({ address: ASSET, abi: erc20, functionName: "decimals" }),
        pub.readContract({ address: ASSET, abi: erc20, functionName: "symbol" }),
        pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "decimals" }),
        pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "symbol" }),
        pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "maxDeposit", args: [DEMO_WALLET] }),
        pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "paused" }).catch(() => false),
      ]);
      const fee = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "feeBps" }).catch(() => pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "redeemFeeBps" }).catch(() => null));
      const wlEnabled = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "whitelistEnabled" }).catch(() => v.requiresWhitelist);
      const whitelisted = wlEnabled ? await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "whitelist", args: [DEMO_WALLET] }).catch(() => false) : true;
      const unlimited = maxDep >= UINT_MAX / 2n;
      const limit = unlimited ? "unlimited" : `${formatUnits(maxDep, assetDecimals)} ${assetSymbol}`;
      Object.assign(entry, { asset: { address: ASSET, symbol: assetSymbol, decimals: Number(assetDecimals) }, shares: { symbol: shareSymbol, decimals: Number(shareDecimals) }, redeemFeeBps: fee != null ? Number(fee) : null, preflight: { depositLimit: limit, whitelistEnabled: wlEnabled, whitelisted, paused } });
      log(`${v.symbol}: asset() ${ASSET} (${assetSymbol}/${assetDecimals}) · maxDeposit(demo) ${limit} · whitelistEnabled ${wlEnabled} · whitelisted ${whitelisted} · paused ${paused}`);

      if (paused) {
        entry.verdict = "REJECT";
        entry.status = "Vault paused on-chain; nothing built.";
        log(`${v.symbol}: ${entry.verdict} — ${entry.status}`);
        continue;
      }
      if (wlEnabled && !whitelisted) {
        entry.verdict = "REJECT";
        entry.status = "Demo wallet is not whitelisted (KYC vault); nothing built.";
        log(`${v.symbol}: ${entry.verdict} — ${entry.status}`);
        continue;
      }
      const units = parseUnits(AMOUNT, assetDecimals);
      if (!unlimited && maxDep < units) {
        entry.verdict = "DEFER";
        entry.status = `Deposit limit ${limit} below ${AMOUNT} ${assetSymbol}: temporarily paused — waiting NAV refresh (per IXS, 24 Sep 2026). Nothing built.`;
        log(`${v.symbol}: ${entry.verdict} — ${entry.status}`);
        continue;
      }

      // Fund the demo wallet from a large holder.
      let whale = null;
      let best = 0n;
      for (const w of C.whales) {
        const b = await pub.readContract({ address: ASSET, abi: erc20, functionName: "balanceOf", args: [w] }).catch(() => 0n);
        if (b > best) {
          best = b;
          whale = w;
        }
      }
      if (!whale || best < units) throw new Error(`no ${assetSymbol} holder with enough balance on the fork`);
      await rpc("anvil_impersonateAccount", [whale]);
      await rpc("anvil_setBalance", [whale, "0x8AC7230489E80000"]);
      const fundHash = await rpc("eth_sendTransaction", [{ from: whale, to: ASSET, data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [DEMO_WALLET, units] }) }]);
      await pub.waitForTransactionReceipt({ hash: fundHash });
      await rpc("anvil_stopImpersonatingAccount", [whale]);
      log(`${v.symbol}: demo wallet funded with ${AMOUNT} ${assetSymbol} from ${whale} (fork tx ${fundHash})`);

      // Calldata from the IXS MCP (direct ABI encoding only as fallback, reported as such).
      let steps;
      let settlement = "sync";
      let builtBy = "IXS MCP vault_build_request_deposit";
      try {
        const plan = await mcp("vault_build_request_deposit", { vaultId: v.routeId, ownerAddress: DEMO_WALLET, assetAmount: units.toString() });
        settlement = plan.settlement ?? settlement;
        steps = plan.steps.map((s) => ({ type: s.type, to: s.tx.to, data: s.tx.data, value: s.tx.value ?? "0x0" }));
      } catch (e) {
        if (/limit|whitelist|paused|exceeds/i.test(e.message)) {
          entry.verdict = "DEFER";
          entry.status = `IXS MCP refused: ${e.message}. Nothing built.`;
          log(`${v.symbol}: ${entry.verdict} — ${entry.status}`);
          continue;
        }
        builtBy = `direct vault ABI (IXS MCP failed: ${e.message})`;
        settlement = /7540/i.test(`${v.subgraphUrl ?? ""}${v.symbol}`) ? "async-erc7540" : "sync";
        steps = [
          { type: "erc20_approve_exact", to: ASSET, data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [VAULT, units] }), value: "0x0" },
          settlement === "sync"
            ? { type: "vault_deposit", to: VAULT, data: encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [units, DEMO_WALLET] }), value: "0x0" }
            : { type: "vault_request_deposit", to: VAULT, data: encodeFunctionData({ abi: vaultAbi, functionName: "requestDeposit", args: [units, DEMO_WALLET, DEMO_WALLET] }), value: "0x0" },
        ];
      }
      log(`${v.symbol}: calldata built by ${builtBy} · settlement ${settlement} · ${steps.length} steps`);

      if (IMPERSONATE_DEMO) await rpc("anvil_impersonateAccount", [DEMO_WALLET]);
      const receipts = [];
      for (const st of steps) {
        const hash = IMPERSONATE_DEMO
          ? await rpc("eth_sendTransaction", [{ from: DEMO_WALLET, to: st.to, data: st.data, value: st.value && st.value !== "0" ? st.value : "0x0" }])
          : await wallet.sendTransaction({ to: st.to, data: st.data, value: BigInt(st.value || 0) });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        receipts.push({ step: st.type, hash, status: receipt.status, gasUsed: Number(receipt.gasUsed), logs: receipt.logs });
        log(`${v.symbol}: ${st.type} ${receipt.status} · gas ${receipt.gasUsed} · fork tx ${hash}`);
        if (receipt.status !== "success") throw new Error(`${st.type} reverted on the fork`);
      }
      entry.calldataBuiltBy = builtBy;
      entry.settlement = settlement;
      entry.txs = receipts.map((r) => ({ step: r.step, hash: r.hash, status: r.status, gasUsed: r.gasUsed }));

      const shares = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "balanceOf", args: [DEMO_WALLET] });
      const unit = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "convertToAssets", args: [10n ** BigInt(shareDecimals)] }).catch(() => null);
      entry.pricePerShare = unit != null ? Number(formatUnits(unit, assetDecimals)) : null;
      const decoded = receipts.flatMap((r) => r.logs).map((l) => { try { return decodeEventLog({ abi: vaultAbi, data: l.data, topics: l.topics }); } catch { return null; } }).filter(Boolean);
      if (settlement === "sync") {
        entry.verdict = "ALLOCATE";
        entry.sharesReceived = Number(formatUnits(shares, shareDecimals));
        entry.sharesValue = Number(formatUnits(await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "convertToAssets", args: [shares] }).catch(() => 0n), assetDecimals));
        const dep = decoded.find((d) => d.eventName === "Deposit");
        entry.depositEvent = dep ? { assets: Number(formatUnits(dep.args.assets, assetDecimals)), shares: Number(formatUnits(dep.args.shares, shareDecimals)) } : null;
        entry.status = `Deposited (sync ERC-4626): ${entry.sharesReceived} ${shareSymbol} ≈ ${entry.sharesValue} ${assetSymbol} minted in the deposit transaction.`;
      } else {
        entry.verdict = "ALLOCATE";
        const req = decoded.find((d) => d.eventName === "DepositRequest");
        entry.request = {
          requestId: req ? req.args.requestId.toString() : null,
          assets: req ? Number(formatUnits(req.args.assets, assetDecimals)) : Number(AMOUNT),
          pendingDepositRequest: Number(formatUnits(await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "pendingDepositRequest", args: [0n, DEMO_WALLET] }).catch(() => 0n), assetDecimals)),
          claimableDepositRequest: Number(formatUnits(await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "claimableDepositRequest", args: [0n, DEMO_WALLET] }).catch(() => 0n), assetDecimals)),
          sharesNow: Number(formatUnits(shares, shareDecimals)),
        };
        entry.status = "Request submitted — pending operator settlement (fork: IXS operator not present). Not a deposit until the operator settles it at the next cutoff.";
      }
      log(`${v.symbol}: ${entry.verdict} — ${entry.status}`);
    }
    console.log(JSON.stringify({ label: "Mainnet fork (Anvil)", chainId: FORK_CHAIN, chain: C.name, forkBlock: Number(forkBlock), amount: `${AMOUNT} USDC`, demoWallet: DEMO_WALLET, vaults: results }, null, 2));
    if (KEEP) {
      log(`KEEP=1: Anvil stays up at ${LOCAL}. Point Vaulto at it with ${FORK_CHAIN === 56 ? "RPC_URL" : "AVAX_RPC_URL"}=${LOCAL} (topbar shows "Mainnet fork"). Ctrl+C to stop.`);
      await new Promise(() => {});
    }
  } finally {
    if (!KEEP) stop();
  }
}

main().catch((e) => {
  console.error("[fork-demo] failed:", e.message ?? e);
  process.exit(1);
});
