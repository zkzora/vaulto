#!/usr/bin/env node
/**
 * Vaulto · Mainnet fork demo (for the video).
 *
 * 1. Starts Anvil as a fork of BNB mainnet (chain 56).
 * 2. Resolves the IX High Yield Bond vault from the IXS Vault API and reads asset() / decimals() from the contract.
 * 3. Impersonates a USDC whale and funds the demo wallet with 100 USDC (+ BNB for gas).
 * 4. Asks the IXS MCP for approve + deposit calldata and sends both from the demo wallet.
 * 5. Reports shares, price per share, sync vs async settlement and, for async vaults, the request status.
 *
 * Everything here runs against the fork only. Labels: "Mainnet fork (Anvil)".
 *
 * Usage:  node --env-file=.env scripts/fork-demo.mjs
 * Env:    FORK_RPC (default bsc-dataseed), ANVIL_BIN, ANVIL_PORT (8545), AMOUNT (100), KEEP=1 (leave Anvil running
 *         so the web app can use RPC_URL=http://127.0.0.1:8545), DEMO_PRIVATE_KEY / DEMO_WALLET, VAULT_ROUTE_ID.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, formatUnits, http, parseAbi, parseUnits } from "viem";
import { bsc } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const FORK_RPC = process.env.FORK_RPC || "https://bsc-dataseed.bnbchain.org";
const PORT = Number(process.env.ANVIL_PORT || 8545);
const LOCAL = `http://127.0.0.1:${PORT}`;
const API = (process.env.IXS_API_BASE_URL || "https://api-v2.ixs.finance").replace(/\/$/, "");
const MCP = process.env.IXS_MCP_URL || "https://api-v2.ixs.finance/mcp";
const AMOUNT = process.env.AMOUNT || "100";
const KEEP = /^(1|true|yes)$/i.test(process.env.KEEP || "");
// Anvil's well-known test account #0 (never holds real value).
const DEMO_KEY = process.env.DEMO_PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const demoAccount = privateKeyToAccount(DEMO_KEY);
const DEMO_WALLET = (process.env.DEMO_WALLET || demoAccount.address);
const IMPERSONATE_DEMO = DEMO_WALLET.toLowerCase() !== demoAccount.address.toLowerCase();
// Large USDC holders on BNB Chain (Binance hot wallets); the script picks whichever holds the most on the fork.
const WHALES = [
  "0xF977814e90dA44bFA03b6295A0616a897441aceC",
  "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3",
  "0xe2fc31F816A9b94326492132018C3aEcC4a93aE1",
  "0x0D0707963952f2fBA59dD06f2b425ace40b492Fe",
  "0xD3a22590f8243f8E83Ac230D1842C9Af0404C4A1",
  "0x5a52E96BAcdaBb82fd05763E25335261B270Efcb",
];

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const vaultAbi = parseAbi([
  "function asset() view returns (address)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function totalAssets() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function previewDeposit(uint256) view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function redeemFeeBps() view returns (uint256)",
  "function whitelistEnabled() view returns (bool)",
  "function deposit(uint256,address) returns (uint256)",
  "function requestDeposit(uint256,address,address) returns (uint256)",
  "function pendingDepositRequest(uint256,address) view returns (uint256)",
  "function claimableDepositRequest(uint256,address) view returns (uint256)",
  "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
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
  // 1. Vault from the IXS Vault API (chain 56, product ixhyb, open unless VAULT_ROUTE_ID is set).
  const api = await (await fetch(`${API}/vaults`)).json();
  const items = (api.items ?? []).filter((v) => v.chainId === 56);
  const vaultItem = process.env.VAULT_ROUTE_ID ? items.find((v) => v.routeId === process.env.VAULT_ROUTE_ID) : items.find((v) => !v.requiresWhitelist) ?? items[0];
  if (!vaultItem) throw new Error("no BNB Chain vault on the IXS API");
  const VAULT = vaultItem.contractAddress;
  log(`vault from IXS API: ${vaultItem.name} (${vaultItem.symbol}) ${VAULT} · routeId ${vaultItem.routeId} · whitelist ${vaultItem.requiresWhitelist}`);

  // 2. Anvil fork.
  const bin = anvilBin();
  log(`starting ${bin} --fork-url ${FORK_RPC} --chain-id 56 --port ${PORT}`);
  const anvil = spawn(bin, ["--fork-url", FORK_RPC, "--chain-id", "56", "--port", String(PORT), "--silent"], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  anvil.stderr.on("data", (d) => (stderr += d.toString()));
  anvil.on("exit", (code) => {
    if (!KEEP && code && code !== 0) log(`anvil exited with ${code}: ${stderr.slice(-400)}`);
  });
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
      const id = await rpc("eth_chainId");
      up = Number(id) === 56;
    } catch {
      await sleep(500);
    }
  }
  if (!up) {
    stop();
    throw new Error(`anvil did not come up: ${stderr.slice(-600)}`);
  }
  const pub = createPublicClient({ chain: bsc, transport: http(LOCAL) });
  const block = await pub.getBlockNumber();
  log(`Mainnet fork (Anvil) ready at ${LOCAL} · forked at block ${block}`);

  try {
    // 3. asset() + decimals() from the contract, never hardcoded.
    const ASSET = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "asset" });
    const [assetDecimals, assetSymbol, shareDecimals, shareSymbol] = await Promise.all([
      pub.readContract({ address: ASSET, abi: erc20, functionName: "decimals" }),
      pub.readContract({ address: ASSET, abi: erc20, functionName: "symbol" }),
      pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "decimals" }),
      pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "symbol" }),
    ]);
    const fee = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "feeBps" }).catch(() => pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "redeemFeeBps" }).catch(() => null));
    log(`asset() = ${ASSET} (${assetSymbol}, ${assetDecimals} decimals) · shares ${shareSymbol} (${shareDecimals} decimals) · redeem fee ${fee != null ? `${Number(fee) / 100}%` : "n/a"}`);
    const units = parseUnits(AMOUNT, assetDecimals);

    // 4. Whale → demo wallet.
    let whale = null;
    let best = 0n;
    for (const w of WHALES) {
      const b = await pub.readContract({ address: ASSET, abi: erc20, functionName: "balanceOf", args: [w] }).catch(() => 0n);
      if (b > best) {
        best = b;
        whale = w;
      }
    }
    if (!whale || best < units) throw new Error("no whale with enough USDC on the fork");
    log(`impersonating whale ${whale} (${formatUnits(best, assetDecimals)} ${assetSymbol})`);
    await rpc("anvil_impersonateAccount", [whale]);
    await rpc("anvil_setBalance", [whale, "0x8AC7230489E80000"]); // 10 BNB for gas
    await rpc("anvil_setBalance", [DEMO_WALLET, "0x8AC7230489E80000"]);
    const fundHash = await rpc("eth_sendTransaction", [{ from: whale, to: ASSET, data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [DEMO_WALLET, units] }) }]);
    await pub.waitForTransactionReceipt({ hash: fundHash });
    await rpc("anvil_stopImpersonatingAccount", [whale]);
    const demoBal = await pub.readContract({ address: ASSET, abi: erc20, functionName: "balanceOf", args: [DEMO_WALLET] });
    log(`demo wallet ${DEMO_WALLET} funded: ${formatUnits(demoBal, assetDecimals)} ${assetSymbol} (fork tx ${fundHash})`);

    // 5. Calldata from the IXS MCP (fallback: standard ERC-4626 encoding, reported as such).
    let steps;
    let settlement = "sync";
    let builtBy = "IXS MCP vault_build_request_deposit";
    try {
      const plan = await mcp("vault_build_request_deposit", { vaultId: vaultItem.routeId, ownerAddress: DEMO_WALLET, assetAmount: units.toString() });
      settlement = plan.settlement ?? settlement;
      steps = plan.steps.map((s) => ({ type: s.type, to: s.tx.to, data: s.tx.data, value: s.tx.value ?? "0x0", description: s.description }));
    } catch (e) {
      builtBy = `local ERC-4626 encoder (IXS MCP failed: ${e.message})`;
      steps = [
        { type: "erc20_approve_exact", to: ASSET, data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [VAULT, units] }), value: "0x0", description: "Approve" },
        { type: "vault_deposit", to: VAULT, data: encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [units, DEMO_WALLET] }), value: "0x0", description: "Deposit" },
      ];
    }
    log(`calldata built by ${builtBy} · settlement ${settlement} · ${steps.length} steps`);

    // 6. Send approve + deposit from the demo wallet (signed with the demo key, or impersonated when DEMO_WALLET has no key here).
    const wallet = createWalletClient({ account: demoAccount, chain: bsc, transport: http(LOCAL) });
    if (IMPERSONATE_DEMO) await rpc("anvil_impersonateAccount", [DEMO_WALLET]);
    const receipts = [];
    for (const st of steps) {
      const hash = IMPERSONATE_DEMO
        ? await rpc("eth_sendTransaction", [{ from: DEMO_WALLET, to: st.to, data: st.data, value: st.value && st.value !== "0" ? st.value : "0x0" }])
        : await wallet.sendTransaction({ to: st.to, data: st.data, value: BigInt(st.value || 0) });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      receipts.push({ step: st.type, hash, status: receipt.status, gasUsed: Number(receipt.gasUsed), logs: receipt.logs });
      log(`${st.type}: ${receipt.status} · gas ${receipt.gasUsed} · fork tx ${hash}`);
      if (receipt.status !== "success") throw new Error(`${st.type} reverted on the fork`);
    }

    // 7. Result.
    const shares = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "balanceOf", args: [DEMO_WALLET] });
    const assetsNow = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "convertToAssets", args: [shares] }).catch(() => null);
    const unit = await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "convertToAssets", args: [10n ** BigInt(shareDecimals)] }).catch(() => null);
    const depositLog = receipts
      .flatMap((r) => r.logs)
      .map((l) => {
        try {
          return decodeEventLog({ abi: vaultAbi, data: l.data, topics: l.topics });
        } catch {
          return null;
        }
      })
      .find((d) => d?.eventName === "Deposit");
    const summary = {
      label: "Mainnet fork (Anvil)",
      chainId: 56,
      forkBlock: Number(block),
      vault: { name: vaultItem.name, symbol: shareSymbol, address: VAULT, routeId: vaultItem.routeId, settlement, redeemFeeBps: fee != null ? Number(fee) : null },
      asset: { address: ASSET, symbol: assetSymbol, decimals: assetDecimals },
      demoWallet: DEMO_WALLET,
      deposited: `${AMOUNT} ${assetSymbol}`,
      calldataBuiltBy: builtBy,
      txs: receipts.map((r) => ({ step: r.step, hash: r.hash, status: r.status, gasUsed: r.gasUsed })),
      sharesReceived: Number(formatUnits(shares, shareDecimals)),
      sharesValue: assetsNow != null ? Number(formatUnits(assetsNow, assetDecimals)) : null,
      pricePerShare: unit != null ? Number(formatUnits(unit, assetDecimals)) : null,
      depositEvent: depositLog ? { assets: Number(formatUnits(depositLog.args.assets, assetDecimals)), shares: Number(formatUnits(depositLog.args.shares, shareDecimals)) } : null,
    };
    if (settlement !== "sync") {
      summary.asyncRequest = {
        pendingDepositRequest: Number(formatUnits(await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "pendingDepositRequest", args: [0n, DEMO_WALLET] }).catch(() => 0n), assetDecimals)),
        claimableDepositRequest: Number(formatUnits(await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "claimableDepositRequest", args: [0n, DEMO_WALLET] }).catch(() => 0n), assetDecimals)),
        mcpRequestStatus: await mcp("vault_request_status", { vaultId: vaultItem.routeId, walletAddress: DEMO_WALLET }).catch((e) => ({ error: e.message })),
      };
    }
    console.log(JSON.stringify(summary, null, 2));
    log(settlement === "sync" ? `sync ERC-4626 deposit settled immediately: ${summary.sharesReceived} ${shareSymbol} ≈ ${summary.sharesValue} ${assetSymbol}` : `async vault: deposit request recorded, see asyncRequest`);

    if (KEEP) {
      log(`KEEP=1: Anvil stays up at ${LOCAL}. Point Vaulto at it with RPC_URL=${LOCAL} (topbar shows "Mainnet fork"). Ctrl+C to stop.`);
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
