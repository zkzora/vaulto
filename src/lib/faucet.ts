import { createWalletClient, formatEther, formatUnits, http, isAddress, parseEther, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { erc20Abi } from "./chain/abi";
import { publicClient } from "./chain/client";
import { CHAIN, CHAIN_NAME, EXPLORER, IXS_BSC, IXS_USDC_SYMBOL, NATIVE_SYMBOL } from "./chain/config";
import { env } from "./env";

/**
 * Vaulto testnet faucet on BSC Testnet. A server-side wallet (FAUCET_PRIVATE_KEY) sends tBNB for gas
 * and forwards IXS test USDC (ixUSDC) while it holds some. ixUSDC is minted by IXS only, so the
 * faucet wallet has to be topped up by the IXS team. Every claim is a real on-chain transaction.
 */

// BSC Testnet gas is ~0.1 gwei: 0.0015 tBNB covers dozens of approve + deposit transactions.
export const FAUCET_AMOUNTS = { NATIVE: 0.0015, IXUSDC: 100 };
/** One claim per wallet, ever. */
export const FAUCET_COOLDOWN_MS = Number.POSITIVE_INFINITY;
const MIN_USER_NATIVE = 0.0005;
export const MIN_FAUCET_NATIVE = 0.002;

const transferAbi = [
  ...erc20Abi,
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

export interface FaucetStatus {
  configured: boolean;
  chainName: string;
  nativeSymbol: string;
  faucetAddress?: string;
  faucetNativeBalance?: number;
  faucetIxUsdcBalance?: number;
  /** True while the faucet can hand out ixUSDC. */
  ixUsdcAvailable: boolean;
  /** True when the faucet wallet cannot pay for its own transactions. */
  faucetLow: boolean;
  amounts: typeof FAUCET_AMOUNTS;
  ixs: { vault: string; usdc: string; usdcSymbol: string; usdcOwner: string };
  explorer: string;
}

export interface FaucetTx {
  kind: "native" | "transfer";
  asset: string;
  amount: number;
  hash: string;
  explorerUrl: string;
}

/** Owner of the IXS test USDC contract (the only minter), for the "ask IXS" hint. */
const IXS_USDC_OWNER = "0xE8eA6365C329130fd47d4D1Ca0aE59CAf49fA9C4";

function faucetAccount() {
  if (!env.faucetPrivateKey) return null;
  try {
    return privateKeyToAccount(env.faucetPrivateKey as `0x${string}`);
  } catch {
    return null;
  }
}

export async function faucetStatus(): Promise<FaucetStatus> {
  const account = faucetAccount();
  let faucetNativeBalance: number | undefined;
  let faucetIxUsdcBalance: number | undefined;
  if (account) {
    try {
      const client = publicClient();
      const [native, ix] = await Promise.all([
        client.getBalance({ address: account.address }),
        client.readContract({ address: IXS_BSC.usdc, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }).catch(() => 0n),
      ]);
      faucetNativeBalance = Number(formatEther(native));
      faucetIxUsdcBalance = Number(formatUnits(ix, IXS_BSC.usdcDecimals));
    } catch {
      faucetNativeBalance = undefined;
    }
  }
  return {
    configured: Boolean(account),
    chainName: CHAIN_NAME,
    nativeSymbol: NATIVE_SYMBOL,
    faucetAddress: account?.address,
    faucetNativeBalance,
    faucetIxUsdcBalance,
    ixUsdcAvailable: (faucetIxUsdcBalance ?? 0) >= FAUCET_AMOUNTS.IXUSDC,
    faucetLow: Boolean(account) && (faucetNativeBalance ?? 0) < MIN_FAUCET_NATIVE,
    amounts: FAUCET_AMOUNTS,
    ixs: { vault: IXS_BSC.hybridVault, usdc: IXS_BSC.usdc, usdcSymbol: IXS_USDC_SYMBOL, usdcOwner: IXS_USDC_OWNER },
    explorer: EXPLORER,
  };
}

export async function claimFaucet(to: string): Promise<{ txs: FaucetTx[] }> {
  if (!isAddress(to)) throw new Error("invalid address");
  const account = faucetAccount();
  if (!account) throw new Error("Faucet not configured: set FAUCET_PRIVATE_KEY");

  const client = publicClient();
  const wallet = createWalletClient({ account, chain: CHAIN, transport: http(env.rpcUrl) });
  const faucetNative = Number(formatEther(await client.getBalance({ address: account.address })));
  if (faucetNative < MIN_FAUCET_NATIVE) throw new Error(`Faucet wallet ${account.address} is low on ${NATIVE_SYMBOL} (${faucetNative.toFixed(4)}). Top it up from a ${CHAIN_NAME} faucet.`);

  const txs: FaucetTx[] = [];
  const recipient = to as `0x${string}`;
  const wait = (hash: `0x${string}`) => client.waitForTransactionReceipt({ hash });

  const userNative = Number(formatEther(await client.getBalance({ address: recipient })));
  if (userNative < MIN_USER_NATIVE) {
    const hash = await wallet.sendTransaction({ to: recipient, value: parseEther(String(FAUCET_AMOUNTS.NATIVE)) });
    await wait(hash);
    txs.push({ kind: "native", asset: NATIVE_SYMBOL, amount: FAUCET_AMOUNTS.NATIVE, hash, explorerUrl: `${EXPLORER}/tx/${hash}` });
  }
  const ixBalance = await client.readContract({ address: IXS_BSC.usdc, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }).catch(() => 0n);
  const ixAmount = parseUnits(String(FAUCET_AMOUNTS.IXUSDC), IXS_BSC.usdcDecimals);
  if (ixBalance >= ixAmount) {
    const hash = await wallet.writeContract({ address: IXS_BSC.usdc, abi: transferAbi, functionName: "transfer", args: [recipient, ixAmount] });
    await wait(hash);
    txs.push({ kind: "transfer", asset: IXS_USDC_SYMBOL, amount: FAUCET_AMOUNTS.IXUSDC, hash, explorerUrl: `${EXPLORER}/tx/${hash}` });
  }
  if (!txs.length) throw new Error(`Nothing to send: your wallet already has gas and the faucet holds no ${IXS_USDC_SYMBOL}. Ask the IXS team for test USDC.`);
  return { txs };
}
