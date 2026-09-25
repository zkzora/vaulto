import { formatUnits, parseUnits } from "viem";
import { erc4626Abi } from "@/lib/chain/abi";
import { publicClient } from "@/lib/chain/client";
import { redeemableMinimum } from "@/lib/chain/config";
import { env } from "@/lib/env";
import { recordEvidence } from "@/lib/evidence";
import type { VaultCheck, VaultPreflight } from "@/lib/types";
import { nextCutoff } from "./cutoff";
import { checkWhitelist, probeDeposit } from "./mcp";
import type { RegistryVault } from "./registry";

/**
 * Pre-flight safety checks for one vault and one wallet, from the IXS MCP, the contracts and the IXS subgraph:
 *  - vault status (API status, paused())                                   → fail = REJECT
 *  - deposit limit for this wallet (maxDeposit(wallet)) + MCP build probe   → 0 = DEFER (NAV-staleness effect, per IXS 24 Sep 2026)
 *  - NAV age (subgraph priceUpdatedAt / NAV_UPDATED) vs the staleness policy → stale = DEFER (waiting NAV refresh)
 *  - minimum deposit 100 USDC (confirmed by IXS) vs the intended amount     → fail = REJECT
 *  - eligibility (vault_check_whitelist) for whitelist-gated vaults          → fail = REJECT
 *  - cutoff / settlement (17:00 SGT business days, per IXS) and redemption path → informational
 * The checks are facts; SERV reasoning turns them into ALLOCATE / DEFER / REJECT with explicit reasons.
 */

const UINT_MAX = 2n ** 256n - 1n;
const cache = new Map<string, { at: number; value: VaultPreflight }>();
const TTL_MS = 60_000;

const fmtAge = (hours: number) => (hours < 48 ? `${hours.toFixed(1)} h ago` : `${(hours / 24).toFixed(1)} days ago`);

export const REDEEM_PATH = "Redemption requested → awaiting RWA sale & operator finalization → paid (USDC sent to the receiver, no claim step)";

export async function runPreflight(v: RegistryVault, wallet: string, amountUsd?: number, opts: { live?: boolean } = {}): Promise<VaultPreflight> {
  const live = opts.live === true;
  const key = `${v.routeId}#${wallet.toLowerCase()}#${amountUsd ?? ""}#${live ? "live" : "sim"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const client = publicClient(v.chainId);
  const minUnits = parseUnits(String(v.minDeposit.usd), v.asset.decimals);
  const [blockRes, maxDepRes, mcp, whitelistedMcp] = await Promise.all([
    client.getBlockNumber().catch(() => null),
    client.readContract({ address: v.address, abi: erc4626Abi, functionName: "maxDeposit", args: [wallet as `0x${string}`] }).catch(() => null),
    probeDeposit(v.routeId, wallet, minUnits),
    v.requiresWhitelist || v.whitelistEnabled ? checkWhitelist(v.routeId, wallet) : Promise.resolve<boolean | null>(true),
  ]);
  const block = blockRes != null ? Number(blockRes) : null;
  // If the IXS MCP could not answer, read whitelist(wallet) on the vault itself.
  let wlSource = "IXS MCP vault_check_whitelist";
  let whitelisted = whitelistedMcp;
  if ((v.requiresWhitelist || v.whitelistEnabled) && whitelisted == null) {
    const onchain = await client.readContract({ address: v.address, abi: erc4626Abi, functionName: "whitelist", args: [wallet as `0x${string}`] }).catch(() => null);
    if (onchain != null) {
      whitelisted = Boolean(onchain);
      wlSource = "whitelist(wallet) on-chain (IXS MCP vault_check_whitelist did not answer)";
    }
  }
  const unlimited = maxDepRes != null && maxDepRes >= UINT_MAX / 2n;
  const limitUsd = maxDepRes == null || unlimited ? null : Number(formatUnits(maxDepRes, v.asset.decimals));
  recordEvidence({ kind: "onchain", label: `${v.chainName} · maxDeposit(${wallet.slice(0, 8)}…) on ${v.symbol}`, chainId: v.chainId, blockNumber: block, request: { vault: v.address, wallet }, response: { maxDeposit: maxDepRes == null ? null : unlimited ? "2^256-1 (unlimited)" : `${limitUsd} ${v.asset.symbol}` }, ok: maxDepRes != null });

  const checks: VaultCheck[] = [];
  const active = v.status === "active" && !v.paused;
  checks.push({ key: "status", label: "Vault status", ok: active, severity: "block", value: v.paused ? "paused" : v.status, detail: v.paused ? "paused() is true on-chain" : `IXS Vault API status "${v.status}", paused() false`, source: "IXS Vault API + paused() on-chain" });

  const needsWl = v.requiresWhitelist || v.whitelistEnabled === true;
  const wlOk = needsWl ? whitelisted === true : true;
  checks.push({
    key: "eligibility",
    label: "Eligibility",
    ok: wlOk,
    severity: "block",
    value: needsWl ? (whitelisted === true ? "whitelisted" : whitelisted === false ? "not whitelisted" : "unknown") : "open vault",
    detail: needsWl ? `KYC whitelist enforced by the vault (whitelistEnabled() true); IXS onboarding required${whitelisted == null ? "; neither the IXS MCP nor whitelist(wallet) answered, so the wallet is treated as not whitelisted" : ""}` : "whitelistEnabled() is false on-chain",
    source: needsWl ? wlSource : "whitelistEnabled() on-chain",
  });

  const age = v.nav.ageHours;
  // Stale if older than Vaulto's policy OR the contract's own navStalenessThreshold() (then maxDeposit is 0 anyway).
  const contractStale = age != null && v.nav.contractThresholdHours != null && age > v.nav.contractThresholdHours;
  const navOk = age != null && age <= env.navStaleHours && !contractStale;
  checks.push({
    key: "nav-age",
    label: "NAV freshness",
    ok: navOk,
    severity: "defer",
    value: age == null ? "unknown" : `${fmtAge(age)}${v.nav.pricePerShare != null ? ` · ${v.nav.pricePerShare.toFixed(6)} ${v.asset.symbol}/share` : ""}`,
    detail: age == null
      ? "no NAV timestamp available from the IXS subgraph"
      : `${age <= env.navStaleHours ? "within" : "older than"} the Vaulto staleness policy of ${env.navStaleHours} h${v.nav.contractThresholdHours != null ? ` (contract navStalenessThreshold() = ${v.nav.contractThresholdHours} h${age > v.nav.contractThresholdHours ? ", exceeded" : ", not exceeded"})` : " (contract exposes no threshold)"}. Last NAV change ${v.nav.updatedAt ? new Date(v.nav.updatedAt * 1000).toISOString() : "?"}${v.nav.block ? ` at block ${v.nav.block}` : ""}${v.nav.lastChangeTx ? ` (tx ${v.nav.lastChangeTx.slice(0, 12)}…)` : ""}. ${navOk ? "" : "Per IXS (24 Sep 2026) a stale NAV drives the deposit limit to 0 until the next refresh: temporarily paused, waiting NAV refresh."}`,
    source: v.nav.source,
  });

  // Limit 0 is the NAV-staleness effect, not a closed vault (IXS, 24 Sep 2026): DEFER, unless the wallet is simply not whitelisted.
  const limitOk = unlimited || (limitUsd != null && limitUsd >= v.minDeposit.usd);
  checks.push({
    key: "deposit-limit",
    label: "Deposit limit",
    ok: limitOk,
    severity: needsWl && !wlOk ? "block" : "defer",
    value: maxDepRes == null ? "unknown" : unlimited ? "unlimited" : `${limitUsd} ${v.asset.symbol}`,
    detail: maxDepRes == null
      ? "maxDeposit() could not be read"
      : unlimited
        ? "maxDeposit(wallet) returns 2^256-1"
        : limitUsd === 0
          ? needsWl && !wlOk
            ? "maxDeposit(wallet) is 0 because the wallet is not whitelisted"
            : "maxDeposit(wallet) is 0: per IXS (24 Sep 2026) this is the NAV-staleness effect between updates, not a closed vault → temporarily paused, waiting NAV refresh"
          : `maxDeposit(wallet) = ${limitUsd} ${v.asset.symbol}`,
    source: `maxDeposit() on-chain · block ${block ?? "?"}`,
  });

  checks.push({
    key: "mcp",
    label: "IXS MCP builds the deposit request",
    ok: mcp.ok,
    severity: limitOk && wlOk ? "block" : "info",
    value: mcp.ok ? `builds approve + deposit for ${v.minDeposit.usd} ${v.asset.symbol}` : "refused",
    detail: mcp.ok ? `vault_build_request_deposit returned calldata (settlement ${mcp.settlement ?? v.settlement})` : `${mcp.reason}${!limitOk ? " (consistent with the on-chain limit)" : ""}`,
    source: "IXS MCP vault_build_request_deposit",
  });

  const amountOk = amountUsd == null ? true : amountUsd >= v.minDeposit.usd;
  checks.push({
    key: "min-deposit",
    label: "Minimum deposit",
    ok: amountOk,
    severity: "block",
    value: `${v.minDeposit.usd} ${v.asset.symbol}`,
    detail: `${amountUsd == null ? "applies to every request" : amountOk ? `intended ${amountUsd.toLocaleString("en-US")} ${v.asset.symbol} is above the minimum` : `intended ${amountUsd.toLocaleString("en-US")} ${v.asset.symbol} is below the minimum`} · 100 USDC confirmed by IXS (24 Sep 2026)`,
    source: v.minDeposit.source,
  });

  // Vaulto guardrail for Live deposits: the whole position must stay redeemable above the net minimum after the fee.
  const rm = redeemableMinimum(v.redeem.minAssetsUsd, v.redeem.feeBps, v.asset.symbol);
  const liveAmountOk = !live || amountUsd == null || amountUsd >= rm.usd;
  checks.push({
    key: "redeemable-min",
    label: "Live deposit minimum (redeemable)",
    ok: liveAmountOk,
    severity: live ? "block" : "info",
    value: `${rm.usd} ${v.asset.symbol}`,
    detail: `${rm.formula}: ${rm.reason}. ${live ? (amountUsd == null ? "Applies to every Live deposit into this vault." : liveAmountOk ? `Intended ${amountUsd.toLocaleString("en-US")} ${v.asset.symbol} meets it.` : `Intended ${amountUsd.toLocaleString("en-US")} ${v.asset.symbol} is below it, so a Live position could not be fully redeemed.`) : "Guardrail for Live deposits; this run is simulated (Live mode is opt-in)."}`,
    source: "Vaulto guardrail · minRedeemAssets() + feeBps() on-chain",
  });

  const cutoff = nextCutoff();
  const observed = v.settlementObserved;
  checks.push({
    key: "cutoff",
    label: "Cutoff / settlement",
    ok: true,
    severity: "info",
    value: v.settlement === "sync" ? "immediate (sync ERC-4626)" : `next cutoff ${cutoff.nextCutoffSgt} (in ${cutoff.hoursUntilCutoff} h)`,
    detail: v.settlement === "sync"
      ? `Deposit mints shares in the same transaction. ${REDEEM_PATH}.`
      : `Async ERC-7540: send before ${cutoff.nextCutoffSgt} to be processed at that cutoff; estimated settlement ${cutoff.estimatedSettlementSgt} (1 business day)${cutoff.skipped.length ? `, skipping ${cutoff.skipped.map((s) => `${s.date} ${s.reason}`).join(", ")}` : ""}. ${observed.samples ? `Observed on-chain: median ${observed.medianHours?.toFixed(1)} h from request to processing over ${observed.samples} requests${observed.pendingCount ? `, ${observed.pendingCount} pending` : ""}.` : "No processed deposit requests on the subgraph yet to confirm the timing."} ${REDEEM_PATH}.`,
    source: v.settlement === "sync" ? "IXS MCP vault_get (settlement sync)" : `${cutoff.source}; ${cutoff.holidayAssumption}`,
  });

  const blocked = checks.some((c) => c.severity === "block" && !c.ok);
  const deferred = !blocked && checks.some((c) => c.severity === "defer" && !c.ok);
  const value: VaultPreflight = {
    ok: !blocked && !deferred,
    verdict: blocked ? "reject" : deferred ? "defer" : "allocate",
    checkedAt: new Date().toISOString(),
    wallet,
    chainId: v.chainId,
    blockNumber: block,
    checks,
    depositLimitUsd: limitUsd,
    depositLimitUnlimited: unlimited,
    navUpdatedAt: v.nav.updatedAt ? new Date(v.nav.updatedAt * 1000).toISOString() : null,
    navAgeHours: age,
    navLastChangeTx: v.nav.lastChangeTx ?? null,
    navLastChangeBlock: v.nav.block,
    minDepositUsd: v.minDeposit.usd,
    settlement: v.settlement,
    observedSettlementHours: observed.medianHours,
    cutoff: v.settlement === "sync" ? null : cutoff,
    redeemPath: REDEEM_PATH,
    mcpAccepts: mcp.ok,
    mcpReason: mcp.ok ? undefined : mcp.reason,
    whitelisted: needsWl ? whitelisted : null,
    live,
    minLiveDepositUsd: rm.usd,
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** One-line summary of the failing checks, for logs and local fallbacks. */
export function preflightSummary(p: VaultPreflight): string {
  const failed = p.checks.filter((c) => c.severity !== "info" && !c.ok);
  return failed.length ? failed.map((c) => `${c.label}: ${c.value}`).join("; ") : "all pre-flight checks passed";
}
