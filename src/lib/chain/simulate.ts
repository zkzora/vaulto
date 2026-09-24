import { BaseError, ContractFunctionRevertedError, RawContractError, decodeErrorResult, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, formatUnits, keccak256, numberToHex } from "viem";
import { erc20Abi, erc4626Abi, vaultErrorsAbi } from "./abi";
import { publicClient, rpcKind } from "./client";
import { modeLabel } from "./config";
import { recordEvidence } from "@/lib/evidence";
import type { StepSimulation, TxStep } from "@/lib/types";

/**
 * "Simulated on <chain> mainnet": runs the exact approve + deposit calldata the IXS MCP built through eth_call
 * against the real vault, with a state override that gives the wallet the USDC balance and allowance the deposit
 * needs. No transaction is sent. Works from any wallet, funded or not. Returns expected shares (decoded from the
 * call and cross-checked with previewDeposit) or the decoded revert reason. Every run lands in the evidence log.
 */

const slotCache = new Map<string, { balance: number; allowance: number }>();
const MAX_SLOT = 24;

const mappingSlot = (key: `0x${string}`, slot: number | bigint) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [key, BigInt(slot)]));
const nestedSlot = (inner: `0x${string}`, key: `0x${string}`) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [key, inner]));
const word = (v: bigint) => numberToHex(v, { size: 32 });

/** Finds the storage slots of balanceOf and allowance mappings by probing overrides (cached per chain + token). */
async function findSlots(chainId: number, token: `0x${string}`, owner: `0x${string}`, spender: `0x${string}`) {
  const key = `${chainId}:${token.toLowerCase()}`;
  const hit = slotCache.get(key);
  if (hit) return hit;
  const client = publicClient(chainId);
  const probe = 987_654_321n * 10n ** 18n;
  let balance = -1;
  for (let s = 0; s < MAX_SLOT && balance < 0; s++) {
    try {
      const r = await client.call({
        to: token,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
        stateOverride: [{ address: token, stateDiff: [{ slot: mappingSlot(owner, s), value: word(probe) }] }],
      });
      if (r.data && decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", data: r.data }) === probe) balance = s;
    } catch (e) {
      throw new Error(`RPC does not support eth_call state overrides: ${e instanceof Error ? e.message.split("\n")[0] : "unknown error"}`);
    }
  }
  if (balance < 0) throw new Error("could not locate the token balance storage slot");
  let allowance = -1;
  const order = [balance + 1, ...Array.from({ length: MAX_SLOT }, (_, i) => i).filter((i) => i !== balance + 1)];
  for (const s of order) {
    try {
      const r = await client.call({
        to: token,
        data: encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [owner, spender] }),
        stateOverride: [{ address: token, stateDiff: [{ slot: nestedSlot(mappingSlot(owner, s), spender), value: word(probe) }] }],
      });
      if (r.data && decodeFunctionResult({ abi: erc20Abi, functionName: "allowance", data: r.data }) === probe) {
        allowance = s;
        break;
      }
    } catch {
      // keep probing
    }
  }
  if (allowance < 0) throw new Error("could not locate the token allowance storage slot");
  const found = { balance, allowance };
  slotCache.set(key, found);
  return found;
}

/** Decodes revert data: Error(string) → the message, Panic → code, known custom errors → name(args). */
function decodeRevertData(data: `0x${string}`): string | null {
  try {
    const d = decodeErrorResult({ abi: vaultErrorsAbi, data });
    const name = d.errorName as string;
    const args = (d.args ?? []) as readonly unknown[];
    if (name === "Error") return String(args[0] ?? "reverted");
    if (name === "Panic") return `Panic(${String(args[0])})`;
    return `${name}(${args.map(String).join(", ")})`;
  } catch {
    return null;
  }
}

function revertReason(e: unknown): string {
  if (e instanceof BaseError) {
    const typed = e.walk((err) => err instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | undefined;
    if (typed?.data) return `${typed.data.errorName}(${(typed.data.args ?? []).map(String).join(", ")})`;
    if (typed?.reason) return typed.reason;
    const raw = e.walk((err) => err instanceof RawContractError) as RawContractError | undefined;
    const rawData = typeof raw?.data === "string" ? raw.data : (raw?.data as { data?: `0x${string}` } | undefined)?.data;
    if (rawData && rawData !== "0x") return decodeRevertData(rawData) ?? `reverted (selector ${rawData.slice(0, 10)})`;
    // Some RPCs put the revert data inside the message ("…: 0x08c379a0…"): decode it instead of echoing hex.
    const msg = e.shortMessage.replace(/^Execution reverted( with reason)?:?\s*/i, "");
    const hex = msg.match(/0x[0-9a-fA-F]{8,}/)?.[0] as `0x${string}` | undefined;
    if (hex) {
      const decoded = decodeRevertData(hex);
      if (decoded) return decoded;
    }
    return msg.replace(/:?\s*0x[0-9a-fA-F]{8,}\.?$/, "").trim() || "reverted";
  }
  return e instanceof Error ? e.message.split("\n")[0] : "reverted";
}

export interface SimulateInput {
  chainId: number;
  owner: `0x${string}`;
  steps: Pick<TxStep, "index" | "kind" | "to" | "data" | "value">[];
  asset: { address: `0x${string}`; decimals: number; symbol: string };
  vault: `0x${string}`;
  amountUnits: bigint;
  shareDecimals: number;
  shareSymbol: string;
}

/** Simulates every step in order; a failed step stops the sequence (later steps are marked skipped). */
export async function simulateDepositSteps(input: SimulateInput): Promise<Record<number, StepSimulation>> {
  const client = publicClient(input.chainId);
  const label = modeLabel("simulated", input.chainId, rpcKind(input.chainId));
  const out: Record<number, StepSimulation> = {};
  const started = Date.now();
  const [block, balance, slots] = await Promise.all([
    client.getBlockNumber().catch(() => null),
    client.readContract({ address: input.asset.address, abi: erc20Abi, functionName: "balanceOf", args: [input.owner] }).catch(() => 0n),
    findSlots(input.chainId, input.asset.address, input.owner, input.vault),
  ]);
  const needBalance = balance < input.amountUnits;
  const balanceDiff = needBalance ? [{ slot: mappingSlot(input.owner, slots.balance), value: word(input.amountUnits) }] : [];
  const allowanceDiff = [{ slot: nestedSlot(mappingSlot(input.owner, slots.allowance), input.vault), value: word(input.amountUnits) }];

  const [preview, unit] = await Promise.all([
    client.readContract({ address: input.vault, abi: erc4626Abi, functionName: "previewDeposit", args: [input.amountUnits] }).catch(() => null),
    client.readContract({ address: input.vault, abi: erc4626Abi, functionName: "convertToAssets", args: [10n ** BigInt(input.shareDecimals)] }).catch(() => null),
  ]);
  const sharePrice = unit != null ? Number(formatUnits(unit, input.asset.decimals)) : undefined;

  let failed = false;
  for (const step of input.steps) {
    if (failed) {
      out[step.index] = { ok: false, label, revertReason: "skipped: previous step reverted", overrides: [], block: block != null ? Number(block) : undefined };
      continue;
    }
    const isApprove = step.kind === "approve";
    const stateDiff = isApprove ? balanceDiff : [...balanceDiff, ...allowanceDiff];
    const overrides = [...(needBalance ? [`${input.asset.symbol} balance → ${formatUnits(input.amountUnits, input.asset.decimals)}`] : []), ...(isApprove ? [] : [`allowance(vault) → ${formatUnits(input.amountUnits, input.asset.decimals)}`])];
    const call = { account: input.owner, to: step.to, data: step.data, value: BigInt(step.value || "0"), stateOverride: stateDiff.length ? [{ address: input.asset.address, stateDiff }] : undefined };
    try {
      const [res, gas] = await Promise.all([client.call(call), client.estimateGas(call).catch(() => null)]);
      let expectedShares: number | undefined;
      let requestId: string | undefined;
      if (!isApprove && res.data && res.data !== "0x") {
        const v = BigInt(res.data);
        if (step.kind === "deposit") expectedShares = Number(formatUnits(v, input.shareDecimals));
        else requestId = v.toString();
      }
      if (step.kind === "deposit" && expectedShares == null && preview != null) expectedShares = Number(formatUnits(preview, input.shareDecimals));
      out[step.index] = {
        ok: true,
        label,
        overrides,
        block: block != null ? Number(block) : undefined,
        gasEstimate: gas != null ? Number(gas) : undefined,
        expectedShares,
        previewShares: preview != null ? Number(formatUnits(preview, input.shareDecimals)) : undefined,
        shareSymbol: input.shareSymbol,
        sharePrice,
        requestId,
      };
    } catch (e) {
      failed = true;
      out[step.index] = { ok: false, label, overrides, block: block != null ? Number(block) : undefined, revertReason: revertReason(e), sharePrice };
    }
  }
  recordEvidence({
    kind: "simulation",
    label: `${label} · eth_call + state override · ${formatUnits(input.amountUnits, input.asset.decimals)} ${input.asset.symbol} → ${input.vault.slice(0, 10)}…`,
    chainId: input.chainId,
    blockNumber: block != null ? Number(block) : null,
    request: { owner: input.owner, vault: input.vault, asset: input.asset, amountUnits: input.amountUnits.toString(), slots, steps: input.steps.map((s) => ({ index: s.index, kind: s.kind, to: s.to, data: s.data })) },
    response: out,
    ok: !failed,
    durationMs: Date.now() - started,
  });
  return out;
}
