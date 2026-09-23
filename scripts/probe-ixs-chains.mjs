// Probes the IXS vaults on Avalanche Fuji (43113) and BSC Testnet (97): MCP deposit builder, whitelist, on-chain shape.
import { createPublicClient, http, parseAbi } from "viem";
import { avalancheFuji, bscTestnet } from "viem/chains";
const MCP = "https://api-dev-v2.ixs.finance/mcp";
async function mcp(name, args) {
  const r = await fetch(MCP, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const t = await r.text(); const line = t.split("\n").filter((l) => l.startsWith("data:")).pop(); return JSON.parse(line ? line.slice(5) : t).result;
}
const vaults = JSON.parse(await (await fetch("https://api-dev-v2.ixs.finance/vaults")).text()).items.filter((v) => [43113, 97].includes(v.chainId));
const owner = "0xCE3963137d2F04b7dDb9c1792a834F0bCe857A7c";
const abi = parseAbi(["function asset() view returns (address)","function decimals() view returns (uint8)","function totalAssets() view returns (uint256)","function supportsInterface(bytes4) view returns (bool)","function maxDeposit(address) view returns (uint256)","function symbol() view returns (string)","function balanceOf(address) view returns (uint256)"]);
for (const v of vaults) {
  const chain = v.chainId === 43113 ? avalancheFuji : bscTestnet;
  const c = createPublicClient({ chain, transport: http() });
  const call = async (fn, args = [], address = v.contractAddress) => { try { return String(await c.readContract({ address, abi, functionName: fn, args })); } catch (e) { return "ERR " + (e.shortMessage || e.message).slice(0, 50); } };
  console.log(`\n== ${v.name} (${v.chainName}) ${v.routeId} whitelist=${v.requiresWhitelist}`);
  console.log("  rpc", chain.rpcUrls.default.http[0], "block", String(await c.getBlockNumber().catch(() => "ERR")), "multicall3", chain.contracts?.multicall3?.address, "code", (await c.getCode({ address: chain.contracts.multicall3.address }).catch(() => "0x"))?.length > 2);
  console.log("  asset", await call("asset"), "decimals", await call("decimals"), "totalAssets", await call("totalAssets"), "erc7540", await call("supportsInterface", ["0xe3bc4e65"]), "maxDeposit", await call("maxDeposit", [owner]));
  const usdc = v.underlyingAsset.address;
  const code = await c.getCode({ address: usdc }).catch(() => "0x");
  const has = (sel) => code.includes(sel.slice(2));
  console.log("  usdc", usdc, "symbol", await call("symbol", [], usdc), "selectors: mint(a,u)", has("0x40c10f19"), "mint(u)", has("0xa0712d68"), "faucet()", has("0xde5f72fd"), "drip()", has("0x9f678cca"), "MINTER_ROLE", has("0xd5391393"));
  const wl = await mcp("vault_check_whitelist", { vaultId: v.routeId, walletAddress: owner });
  console.log("  mcp whitelist:", JSON.stringify(wl).slice(0, 160));
  const dep = await mcp("vault_build_request_deposit", { vaultId: v.routeId, ownerAddress: owner, assetAmount: "100000000" });
  console.log("  mcp build deposit:", JSON.stringify(dep).slice(0, 700));
}
