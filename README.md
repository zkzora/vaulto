# Vaulto — AI treasury allocation agent for IXS RWA vaults

Vaulto scans a DAO or Web3 company treasury, finds idle capital and routes it into the **IX High Yield Bond (USDC) vaults on BNB Chain and Avalanche mainnet** through the IXS MCP. Every allocation, deferral and rejection is decided by **SERV reasoning (OpenServ)** from pre-flight facts read from the IXS MCP, the vault contracts and the IXS subgraphs. **SERV decides; deterministic policy guardrails enforce hard limits.** Nothing moves without the wallet's signature.

Built for the OpenServ SERV Hackathon Edition 01, **RWA Vaults powered by IXS Finance** track.

| | |
|---|---|
| Live demo | https://vaulto-five.vercel.app (Launch Vaulto → Continue with demo treasury) |
| Evidence | https://vaulto-five.vercel.app/evidence · JSON: https://vaulto-five.vercel.app/api/evidence |
| Committed evidence | [`evidence/`](evidence) (snapshot of the public demo run + mainnet-fork runs) |
| Video (≤ 2 min) | _link added after upload_ |
| Source | https://github.com/zkzora/vaulto |

## Submission mode: simulated on BNB mainnet

On 24 Sep 2026 the hackathon judges stated: "mainnet is preferable but simulated is acceptable." Vaulto's own policy is to use no mock tokens and no mock vaults, so it runs against the **real IXS vaults on mainnet** and simulates the deposit itself:

- **Simulated on BNB mainnet** (the default): the approve + deposit calldata built by the IXS MCP runs through `eth_call` with a **state override** (the wallet's USDC balance and allowance) against the real vault. The result is the expected shares, cross-checked with `previewDeposit`, the gas estimate and the block, or the decoded revert reason. It works from any wallet, funded or empty. Nothing is sent.
- **Replay: BNB mainnet state @ block N**: the same analysis and simulation against the mainnet state of a past block where the ixv1 NAV was fresh (default block 123,779,792, 24 Sep 2026 15:19 UTC, NAV 38.1 h old against the 48 h contract threshold), read through an archive RPC. Toggle **Current ↔ Replay** on the dashboard; the default view is always the current state. See [Replay](#replay-mode).
- **Mainnet fork (block N)**: `scripts/fork-demo.mjs` forks BNB Chain or Avalanche with Anvil, funds a test wallet on the fork only, sends the IXS MCP calldata and reads the result back.
- **Live (opt-in, ready, not executed in this submission)**: a viewer can enable Live for a wallet in Settings. The wallet then signs an exact-amount approve and the deposit, with a hard cap of 150 USDC per transaction and a minimum of 104 USDC into ixv1 (see guardrails). No Live deposit was executed for this submission.

A simulated step never gets a fake hash, and an async request is shown as "Request submitted — pending operator settlement" until the IXS operator settles it.

## What SERV does

Two OpenServ Inference calls per analysis (`src/lib/openserv/reasoning.ts`):

1. **Decision.** SERV receives every candidate vault with its pre-flight facts, the Planner's caps and the guardrails, and returns **one verdict per vault**: `ALLOCATE` (with an amount inside the cap), `DEFER` ("temporarily paused — waiting NAV refresh") or `REJECT`, each with a reason that cites the facts.
2. **Narrative and memo.** SERV writes the explanation and a seven-section allocation memo (treasury condition, policy, proposed allocation, deferred, rejected, risks, execution).

The exact input and the raw output of both calls are stored on the recommendation and shown on the Strategy page and on `/evidence`. A deterministic validator overrides a SERV allocation only if it breaks a guardrail; overrides are logged and counted (`validatorOverrides`, 0 in the committed snapshot). The verdicts and the memo are attributed separately.

**SERV output cache and cost.** Each SERV output is stored under a hash of its inputs: vault state as read on-chain (deposit limit, NAV timestamp, TVL, whitelist, the pre-flight outcome per check), treasury balances, policy, guardrails, block (replay block or current) and the prompt version. An identical request reuses the stored output and is labelled "SERV output (cached from <timestamp>)"; guardrails, the validator and the simulation still run on the current state. "Re-run SERV" always calls OpenServ again. Seeds for the demo views are committed in `evidence/serv-cache/` (`npm run serv-cache:seed`), so a cold serverless instance serves them too. If a SERV call fails (402 credits, 401, timeout, unparseable output), the page says "SERV unavailable — showing last SERV output from <timestamp>" for identical inputs, or "Local fallback — SERV unavailable (<reason>)" when there is none; it never falls back silently. Every SERV call is priced from its token usage and the OpenServ `/v1/models` pricing (gpt-5.4-mini: $1.00 / 1M input, $6.00 / 1M output tokens): one analysis costs about $0.022–0.025 (≈7.3k input + 0.5k output tokens for the verdicts, ≈5.8k + 1.3k for the memo), a cached one $0. The OpenServ Inference API has no balance endpoint; the remaining credit is shown in the OpenServ console.

## Guardrails (deterministic)

| Guardrail | Value | Enforced by |
|---|---|---|
| Liquidity floor | 30% of the treasury stays liquid (policy, editable) | Planner caps |
| Single-asset exposure | 70% max (policy) | Risk Guardian |
| Minimum vault risk score | 80 (policy) | Risk Guardian |
| Minimum deposit | 100 USDC per request (stated by IXS) | pre-flight, Planner |
| Live redeemable minimum | **104 USDC into ixv1** = ceil(100 / 0.995 × 1.03): the whole position must stay redeemable above the 100 USDC net `minRedeemAssets()` after the 0.5% `feeBps()` redeem fee, with a 3% NAV buffer | pre-flight, Planner, validator, Execution Agent |
| Vault concentration | one leg ≤ min(policy cap, **25% of the vault's TVL** = `totalAssets()` before the deposit), never below the 100 USDC minimum; if that cap is under 100 USDC the vault is DEFERRED for capacity (`MAX_VAULT_TVL_SHARE_PCT`) | Planner caps, SERV prompt, validator (clamps and counts), memo, Risk Center |
| Live cap | 150 USDC per transaction on the demo deployment (`MAX_LIVE_TX_USDC`) | Planner, Execution Agent |
| NAV staleness | 72 h Vaulto policy, plus the contract's `navStalenessThreshold()` (48 h on ixv1) through `maxDeposit()` | pre-flight → DEFER |

Why 104 USDC: the fork run at block 123779792 shows a 100 USDC deposit minting 91.65 ixv1, and the eth_call redeem simulation in the evidence snapshot shows that redeeming 91.65 ixv1 returns 99.5 USDC net, below the 100 USDC minimum, so `requestRedeem` reverts with `below min redeem`. The shares of a 104 USDC deposit (95.32 ixv1) redeem for 103.48 USDC net.

## IXS integration

- **IXS Vault API** (`https://api-v2.ixs.finance/vaults`): vault addresses, route ids, status, whitelist flag, subgraph URLs. No address is hardcoded except a fallback skeleton used when the API is down.
- **IXS MCP** (`https://api-v2.ixs.finance/mcp`, JSON-RPC over POST): `vault_get` (settlement kind and pricing), `vault_check_whitelist`, `vault_build_request_deposit` (approve exact + deposit / requestDeposit calldata), `vault_build_request_redeem`. If `vault_get` ever disagrees with the vault's subgraph family on the settlement kind, the family wins and the conflict is recorded.
- **Vault contracts**, read through Multicall3 with block numbers: `asset()`, `decimals()`, `maxDeposit(wallet)`, `totalAssets()`, `convertToAssets()`, `paused()`, `whitelistEnabled()`, `feeBps()`, `priceUpdatedAt()`, `navStalenessThreshold()`, `minRedeemAssets()`, `previewDeposit()`, `previewRedeem()`.
- **IXS Goldsky subgraphs**: NAV history with transaction hashes (receipts verified on-chain), deposit and redeem request lifecycle, observed settlement lag.

### Vaults and status (read 25 Sep 2026)

| Vault | Chain | Type | Status on 25 Sep 2026 | Vaulto verdict |
|---|---|---|---|---|
| `ixv1` 0xc975a3Ee…fCB82 | BNB Chain | open, sync ERC-4626 | NAV refreshed about every 48 h; between refreshes older than the 48 h contract threshold, `maxDeposit` is 0 | ALLOCATE when the NAV is fresh, DEFER while `maxDeposit` is 0 |
| `ix7540v1` 0xD84129f5…0802E | BNB Chain | licensed, async ERC-7540, KYC | wallet not whitelisted | REJECT |
| `IXHYB` 0xaD01573b…A8bD9 | Avalanche | open, async ERC-7540 | `maxDeposit` 0, NAV from 14 Sep 2026 | DEFER (waiting NAV refresh) |
| `IXHYB` 0x864E9C19…B41 | Avalanche | licensed, async ERC-7540, KYC | wallet not whitelisted | REJECT |
| BTC Real Yield | — | announced by IXS | no vault on the IXS Vault API | REJECT |

On 27 Sep 2026 at 13:50:52 UTC IXS refreshed the `ixv1` NAV (`priceUpdatedAt`); `maxDeposit` became unlimited again (TVL 650.90 USDC), so the current state allocates too until the NAV is 48 h old (about 29 Sep 2026 13:50 UTC). See `evidence/snapshot-2026-09-27.json`.

### What IXS stated, and what is Vaulto policy

**IXS stated** (24 Sep 2026, reply in the public OpenServ Telegram):

- Cutoff 17:00 SGT on Singapore business days (Mon–Fri); requests can be sent at any time and are processed at the next cutoff.
- Building directly against the vault contract, without the IXS API or MCP, is allowed.
- Minimum deposit: 100 USDC.
- A deposit limit of 0 relates to NAV staleness (NAV drift between updates).
- Redemption has no claim step: the operator sends USDC directly to the receiver.

**The hackathon judges stated** (24 Sep 2026): "mainnet is preferable but simulated is acceptable."

**Vaulto policy** (our interpretation, not a quote):

- A deposit limit of 0 or a stale NAV → DEFER ("temporarily paused, waiting NAV refresh"), not REJECT.
- Direct contract builds only as a fallback when the IXS MCP fails for a non-safety reason, never when the deposit-limit or NAV checks fail. In Replay (a past block, simulation only) the calldata is encoded directly because the MCP builds against the current state only.
- No mock tokens or mock vaults.
- Live deposits into ixv1 need at least 104 USDC (formula above).
- The settlement estimate (about one business day after the cutoff) and the Singapore holiday calendar are Vaulto assumptions.

The same split is on `/evidence`, in `GET /api/evidence` (`statements.ixsStated`, `statements.judgesStated`, `statements.vaultoPolicy`) and in the committed snapshots.

## Replay mode

The open vaults are only accepting deposits while their NAV is fresh: ixv1's `navStalenessThreshold()` is 48 h, and between refreshes `maxDeposit()` drops to 0 and Vaulto defers the vault. So that the ALLOCATE path can always be shown, **Replay** runs the whole pipeline (pre-flight, SERV verdicts, Planner, memo, simulation) against the BNB mainnet state at a fixed past block:

- Default block **123,779,792** (24 Sep 2026 15:19:38 UTC): ixv1 NAV 38.1 h old, deposit limit unlimited. It is also the block of the committed fork run 100 USDC → 91.65 ixv1. Other blocks can be picked from recent NAV updates.
- Reads go through an archive RPC (`BSC_ARCHIVE_RPC_URL`, default `https://bsc-mainnet.public.blastapi.io`; Avalanche at its block closest in time via `AVAX_ARCHIVE_RPC_URL`). A pinned viem transport rewrites the `latest` block tag, so multicall, `eth_call` with state overrides and gas estimates all see that block.
- The IXS MCP builds against the current state only, so Replay encodes approve + deposit directly against the vault ABI (IXS stated direct contract builds are allowed) and only simulates them. Live is off in Replay; nothing is ever sent.
- Every view is labelled "Replay: BNB mainnet state @ block N (NAV fresh at that block)". Recommendations are kept per view.

Committed Replay evidence: `evidence/replay-block123779792.json`. At that block ixv1's `totalAssets()` is 655.87 USDC, so the concentration guardrail caps the leg at 25% of TVL: SERV allocates 163.96 USDC (25% of the vault's TVL before the deposit, 20% after it) and the simulated deposit returns about 150.27 ixv1. Without the guardrail the Planner's policy cap would have been 572,000 USDC, about 872 times the vault's size.

## Recording-window watcher

`.github/workflows/nav-watch.yml` runs `scripts/nav-watch.mjs` every 10 minutes. When ixv1 (or the open Avalanche vault) accepts deposits again or its NAV changes, it opens a `nav-watch` issue in this repository (GitHub emails the repository owner) and posts to `NOTIFY_WEBHOOK_URL` if that repository secret is set. Inside the app, the Monitoring Agent flags the same change on the next scan.

From the IXS subgraph (66 ixv1 NAV updates, 8 Jun – 23 Sep 2026): mean gap 39.4 h, median 39.2 h, last 10 gaps 46.8 h on average; 18 of 65 gaps exceeded the 48 h threshold, so historically the vault accepted deposits about 92% of the time. Updates cluster between 08:00 and 10:00 SGT on weekdays but also happen later in the day and at weekends.

## Pre-flight per vault

| Check | Source | Fails → |
|---|---|---|
| Vault status | IXS Vault API `status`, `paused()` | REJECT |
| Eligibility | IXS MCP `vault_check_whitelist`, `whitelistEnabled()` | REJECT |
| NAV freshness | `priceUpdatedAt()` vs 72 h policy and `navStalenessThreshold()` | DEFER |
| Deposit limit | `maxDeposit(wallet)` | DEFER (Vaulto policy; IXS stated a 0 limit relates to NAV staleness) |
| IXS MCP builds the request | `vault_build_request_deposit` probe | REJECT when the vault is otherwise open |
| Minimum deposit | 100 USDC (stated by IXS) | REJECT |
| Live redeemable minimum | `minRedeemAssets()` + `feeBps()` | REJECT in Live mode, informational in Simulate |
| Cutoff / settlement | cutoff stated by IXS; settlement estimate is Vaulto's, cross-checked with subgraph `depositRequests` | informational |

## Evidence

`/evidence` shows, and `GET /api/evidence` exports: the dated IXS and judge statements; every vault with deposit limit, price per share, NAV timestamp, last NAV change transaction and read block (live); the committed snapshot of the latest public demo run (SERV verdicts with input and output, pre-flight per vault, memo, deposit and redeem simulations, and the call log of that run); the mainnet-fork runs; and a call log that stacks the answering server instance's entries, the entries returned to your own browser's analyze and simulate requests, and the snapshot's entries, so the page is never empty on a fresh serverless instance. The analyze, simulate and execute responses carry the evidence recorded while serving them.

Committed files in [`evidence/`](evidence):

- `snapshot-2026-09-27.json`: public demo run on the current state right after the 27 Sep 2026 ixv1 NAV refresh, captured from https://vaulto-five.vercel.app with `npm run evidence:snapshot`: SERV ALLOCATE 162.72 USDC (25% of the 650.90 USDC TVL) → 150.2743 ixv1 by `eth_call` at BNB block 124,346,771; 104 USDC with IXS MCP calldata → 96.0455 ixv1; 0 validator overrides.
- `snapshot-2026-09-25.json`: the same run on 25 Sep 2026, while both open vaults were at limit 0 (every vault DEFER or REJECT).
- `replay-block123779792.json`: the same run in Replay at block 123,779,792 (`REPLAY_BLOCK=123779792 npm run evidence:snapshot`).
- `fork-bnb-block123779792-100usdc.json`: 100 USDC → 91.65 ixv1 on a BNB mainnet fork (approve + deposit fork transactions).
- `fork-bnb-block123785153-101usdc-redeem.json`: 101 USDC deposit, then `requestRedeem` queued on the fork.
- `fork-bnb-block123868127.json`, `fork-avalanche-block96093431.json`: 25 Sep 2026 forks, both open vaults at limit 0 → DEFER, licensed vaults → REJECT.
- `serv-cache/<hash>.json`: stored SERV outputs (raw JSON, model, token usage and cost) for the demo views, reused for identical inputs.

## Revenue model

A routing fee of **25 bps per year on the AUM Vaulto routes into IXS vaults**, taken from vault yield. No fee on idle capital and none on deferred or rejected allocations. Target users: DAO treasuries, crypto startups and small funds that want RWA yield with policy guardrails and an audit trail, without an ops desk watching cutoffs, NAV updates and deposit limits.

## Run it locally

```bash
git clone https://github.com/zkzora/vaulto && cd vaulto
cp .env.example .env        # add OPENSERV_API_KEY (serv_…)
npm install
npm run dev                 # http://localhost:3000
```

Open **Launch Vaulto → Continue with demo treasury** (Acme DAO, labelled "Simulated treasury": 12.4 BTC and 942,520 USDC, all idle, no pre-existing vault position), then **Run analysis**. A real wallet works too: every IXS vault still gets a verdict, even with nothing idle.

Mainnet fork (requires Foundry's `anvil`):

```bash
npm run fork:demo                                # BNB Chain fork, every IXS vault on the chain
AMOUNT=104 REDEEM=1 npm run fork:demo            # deposit, then requestRedeem of the minted shares
FORK_CHAIN=43114 npm run fork:demo               # Avalanche fork
KEEP=1 npm run fork:demo                         # leave Anvil running, then RPC_URL=http://127.0.0.1:8545 npm run dev
```

The script prints its result as JSON on stdout (progress on stderr). A vault with a deposit limit of 0 is reported as DEFER and nothing is built.

Evidence snapshot of a deployment:

```bash
BASE_URL=https://vaulto-five.vercel.app npm run evidence:snapshot   # writes evidence/snapshot-YYYY-MM-DD.json
```

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OPENSERV_API_KEY` | — | OpenServ Inference API key (SERV reasoning) |
| `OPENSERV_MODEL` | `gpt-5.4-mini` | model on the OpenServ gateway |
| `RPC_URL`, `AVAX_RPC_URL` | public RPCs that honour state overrides | point at Anvil for a fork |
| `IXS_API_BASE_URL`, `IXS_MCP_URL` | IXS production | Vault API and MCP |
| `MAX_LIVE_TX_USDC` | 25000 (150 on the demo deployment) | Live cap per transaction |
| `LIVE_MODE` | `opt-in` | `off` disables Live on a deployment |
| `NAV_STALE_HOURS` | 72 | Vaulto NAV staleness policy |
| `DATABASE_URL` | empty (JSON store) | PostgreSQL via Prisma |

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/treasury?address=` | Snapshot (on-chain per chain + simulated treasury), execution mode, watcher, next cutoff |
| GET | `/api/vaults` | Catalog from the registry (API addresses + contract and subgraph reads) |
| POST | `/api/analyze` | Full pipeline → verdicts, allocation, memo, trace |
| POST | `/api/simulate` | Pre-flight + IXS MCP calldata + eth_call simulation of a deposit or redeem, from any wallet |
| POST / PUT | `/api/execute` | Prepare (calldata + simulation, or unsigned transactions in Live mode) / finalize |
| GET | `/api/evidence` | Evidence export |
| GET / PATCH | `/api/settings` | Policy, simulated treasury, Live opt-in; `?ping=1` checks OpenServ |

## Architecture

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · RainbowKit + wagmi + viem (BNB Chain 56, Avalanche 43114) · OpenServ Inference API · IXS Vault API + MCP + Goldsky subgraphs · PostgreSQL via Prisma or a JSON store.

Six agents: Treasury Scanner, Opportunity Finder, Risk Guardian (pre-flight facts), Allocation Planner (caps), Execution Agent (IXS MCP calldata, simulation or unsigned transactions), Monitoring Agent (NAV and deposit-limit watcher). SERV reasoning makes the decisions between the Risk Guardian and the Planner's validation.

## Security model and known limits

- Vaulto holds no keys and never signs. The IXS MCP builds calldata, simulations are read-only `eth_call`s, and in Live mode the wallet signs every transaction.
- Approvals are for the exact deposit amount; Live transactions are capped and never below the redeemable minimum.
- On Vercel the JSON store and the call log live in memory per serverless instance, and every API route is its own function; the execute flow is stateless, the simulated treasury's simulated deposits travel in an httpOnly cookie per treasury and view (Current or the Replay block; cleared by "Reset demo state"), the SERV cache is per instance plus the committed seeds, and `/evidence` falls back to the committed snapshot. Set `DATABASE_URL` for persistence.
- The IXS MCP tool `vault_request_status` currently fails upstream with a schema error; request status is read from the IXS subgraph instead.
