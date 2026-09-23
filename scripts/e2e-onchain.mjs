// End-to-end proof on BSC Testnet with a throwaway wallet: faucet claim (tBNB + ixUSDC) → scan → analyze →
// prepare (IXS MCP calldata) → sign the steps (what the wallet would do) → finalize → positions read back from the
// IXS vault. Requires the faucet wallet to hold IXS test USDC (minted by IXS only).
import { createPublicClient, createWalletClient, http, formatEther, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const API = process.env.VAULTO_API_URL ?? "http://localhost:3000";
const EXPLORER = "https://testnet.bscscan.com";
const rpc = process.env.RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL ?? "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const pk = process.env.E2E_PRIVATE_KEY ?? generatePrivateKey();
const account = privateKeyToAccount(pk);
const address = account.address.toLowerCase();
const pub = createPublicClient({ chain: bscTestnet, transport: http(rpc) });
const wallet = createWalletClient({ account, chain: bscTestnet, transport: http(rpc) });
const j = async (path, init) => { const r = await fetch(API + path, { ...init, headers: { "content-type": "application/json" } }); const b = await r.json(); if (!r.ok) throw new Error(b.error ?? r.status); return b; };
const t0 = Date.now(); const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

log("test wallet", account.address);
const status = await j("/api/faucet");
if (!status.ixUsdcAvailable) {
  log(`faucet holds ${status.faucetIxUsdcBalance ?? 0} ixUSDC; it needs at least ${status.amounts.IXUSDC} to run the on-chain flow. Ask IXS to send test USDC to ${status.faucetAddress}.`);
  process.exit(2);
}
const claim = await j("/api/faucet", { method: "POST", body: JSON.stringify({ address }) });
for (const t of claim.txs) log("faucet", t.kind, t.amount, t.asset, t.explorerUrl);
await new Promise((r) => setTimeout(r, 3000));

const before = await j(`/api/treasury?address=${address}`);
log("treasury", { total: before.snapshot.totalUsd, balances: before.snapshot.onchain.balances, native: before.snapshot.onchain.nativeBalance, demo: before.user.demoMode, assets: before.snapshot.assets.map((a) => `${a.symbol} ${a.balance}`) });

const an = await j("/api/analyze", { method: "POST", body: JSON.stringify({ address }) });
const rec = an.recommendation;
log("recommendation", { source: rec.reasoningSource, total: rec.totalUsd, legs: rec.legs.map((l) => `${l.amount} ${l.asset} → ${l.vaultName} onchain=${l.onchainAmount}`) });
log("headline:", rec.headline);
if (!rec.legs.length) throw new Error("no legs");

const { prepared } = await j("/api/execute", { method: "POST", body: JSON.stringify({ address, recommendationId: rec.id, simulate: false }) });
if (prepared.mode === "simulated") throw new Error("expected on-chain steps, got simulated");
log("prepared", prepared.mode, prepared.steps.map((s) => `${s.index}:${s.kind} ${s.amount} ${s.asset} ${s.mode} ${s.builtBy} → ${s.to}`));

const results = [];
for (const s of prepared.steps) {
  if (s.mode !== "onchain") { results.push({ index: s.index, status: "simulated", hash: "0xsim" }); continue; }
  if (s.precheck?.kind === "allowance") {
    const abi = parseAbi(["function allowance(address,address) view returns (uint256)"]);
    for (let i = 0; i < 20; i++) {
      const a = await pub.readContract({ address: s.precheck.token, abi, functionName: "allowance", args: [account.address, s.precheck.spender] }).catch(() => 0n);
      if (a >= BigInt(s.precheck.amount)) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  let hash;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { hash = await wallet.sendTransaction({ to: s.to, data: s.data, value: BigInt(s.value || "0") }); break; }
    catch (err) { if (attempt === 2) throw err; log("send retry", s.kind, (err.shortMessage || err.message).slice(0, 60)); await new Promise((r) => setTimeout(r, 2500)); }
  }
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  log("signed", s.kind, s.vaultName, rcpt.status, `${EXPLORER}/tx/${hash}`);
  results.push({ index: s.index, status: rcpt.status === "success" ? "confirmed" : "failed", hash });
}
const fin = await j("/api/execute", { method: "PUT", body: JSON.stringify({ address, preparedId: prepared.id, results }) });
log("finalized", fin.recommendation?.status, fin.transactions.map((t) => `${t.kind} ${t.strategy} $${t.amountUsd} ${t.status}`));

await new Promise((r) => setTimeout(r, 3000));
const after = await j(`/api/treasury?address=${address}`);
log("after", { total: after.snapshot.totalUsd, idlePct: after.snapshot.idlePct, balances: after.snapshot.onchain.balances, positions: after.snapshot.onchain.positions, health: after.snapshot.healthScore });
log("wallet tBNB left", formatEther(await pub.getBalance({ address: account.address })));
