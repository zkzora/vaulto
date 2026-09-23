// Deploys the Vaulto faucet tokens and IXS-mirror ERC-4626 vaults to BSC Testnet (node --env-file=.env scripts/deploy-testnet.mjs).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = JSON.parse(readFileSync(join(root, "contracts", "artifacts.json"), "utf8"));
const account = privateKeyToAccount(process.env.FAUCET_PRIVATE_KEY);
const rpc = process.env.RPC_URL ?? "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const publicClient = createPublicClient({ chain: bscTestnet, transport: http(rpc) });
const wallet = createWalletClient({ account, chain: bscTestnet, transport: http(rpc) });
const balance = await publicClient.getBalance({ address: account.address });
console.log(`deployer ${account.address} · ${formatEther(balance)} tBNB on BSC Testnet`);
if (balance < 2_000_000_000_000_000n) throw new Error("Fund the deployer with at least 0.002 tBNB first");
async function deploy(name, args) {
  const { abi, bytecode } = artifacts[name];
  const hash = await wallet.deployContract({ abi, bytecode, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${name} deployment failed (${hash})`);
  console.log(`${name.padEnd(12)} ${receipt.contractAddress}  tx ${hash}`);
  return receipt.contractAddress;
}
const usdc = await deploy("FaucetToken", ["Vaulto Test USDC", "tUSDC", 6, account.address]);
const btc = await deploy("FaucetToken", ["Vaulto Test BTC", "tBTC", 8, account.address]);
const vaultUsdc = await deploy("VaultoVault", [usdc, "IXS Tokenized RWA Yield (Vaulto testnet)", "ixRWA-tUSDC", "ixs-tokenized-rwa-yield"]);
const vaultBtc = await deploy("VaultoVault", [btc, "IXS BTC Real Yield (Vaulto testnet)", "ixBTC-tBTC", "ixs-btc-real-yield"]);
mkdirSync(join(root, "deployments"), { recursive: true });
writeFileSync(
  join(root, "deployments", "bsc-testnet.json"),
  JSON.stringify(
    {
      chainId: 97,
      network: "bsc-testnet",
      deployer: account.address,
      deployedAt: new Date().toISOString(),
      tokens: { USDC: { address: usdc, symbol: "tUSDC", decimals: 6 }, BTC: { address: btc, symbol: "tBTC", decimals: 8 } },
      vaults: { "ixs-tokenized-rwa-yield": { address: vaultUsdc, asset: "USDC" }, "ixs-btc-real-yield": { address: vaultBtc, asset: "BTC" } },
    },
    null,
    2,
  ),
);
console.log("wrote deployments/bsc-testnet.json");
