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

The hackathon judges confirmed on 24 Sep 2026 that simulated execution is accepted (mainnet preferable) and that mock tokens or mock vaults are not. Vaulto therefore runs against the **real IXS vaults on mainnet** and simulates the deposit itself:

- **Simulated on BNB mainnet** (the default): the approve + deposit calldata built by the IXS MCP runs through `eth_call` with a **state override** (the wallet's USDC balance and allowance) against the real vault. The result is the expected shares, cross-checked with `previewDeposit`, the gas estimate and the block, or the decoded revert reason. It works from any wallet, funded or empty. Nothing is sent.
- **Mainnet fork (block N)**: `scripts/fork-demo.mjs` forks BNB Chain or Avalanche with Anvil, funds a test wallet on the fork only, sends the IXS MCP calldata and reads the result back.
- **Live (opt-in, ready, not executed in this submission)**: a viewer can enable Live for a wallet in Settings. The wallet then signs an exact-amount approve and the deposit, with a hard cap of 150 USDC per transaction and a minimum of 104 USDC into ixv1 (see guardrails). No Live deposit was executed for this submission.

A simulated step never gets a fake hash, and an async request is shown as "Request submitted — pending operator settlement" until the IXS operator settles it.

## What SERV does

Two OpenServ Inference calls per analysis (`src/lib/openserv/reasoning.ts`):

1. **Decision.** SERV receives every candidate vault with its pre-flight facts, the Planner's caps and the guardrails, and returns **one verdict per vault**: `ALLOCATE` (with an amount inside the cap), `DEFER` ("temporarily paused — waiting NAV refresh") or `REJECT`, each with a reason that cites the facts.
2. **Narrative and memo.** SERV writes the explanation and a seven-section allocation memo (treasury condition, policy, proposed allocation, deferred, rejected, risks, execution).

The exact input and the raw output of both calls are stored on the recommendation and shown on the Strategy page and on `/evidence`. A deterministic validator overrides a SERV allocation only if it breaks a guardrail; overrides are logged and counted (`validatorOverrides`, 0 in the demo runs). If OpenServ is unreachable, the deterministic engine takes over and everything is labelled "local".

## Guardrails (deterministic)

| Guardrail | Value | Enforced by |
|---|---|---|
| Liquidity floor | 30% of the treasury stays liquid (policy, editable) | Planner caps |
| Single-asset exposure | 70% max (policy) | Risk Guardian |
| Minimum vault risk score | 80 (policy) | Risk Guardian |
| Minimum deposit | 100 USDC per request (confirmed by IXS) | pre-flight, Planner |
| Live redeemable minimum | **104 USDC into ixv1** = ceil(100 / 0.995 × 1.03): the whole position must stay redeemable above the 100 USDC net `minRedeemAssets()` after the 0.5% `feeBps()` redeem fee, with a 3% NAV buffer | pre-flight, Planner, validator, Execution Agent |
| Live cap | 150 USDC per transaction on the demo deployment (`MAX_LIVE_TX_USDC`) | Planner, Execution Agent |
| NAV staleness | 72 h Vaulto policy, plus the contract's `navStalenessThreshold()` (48 h on ixv1) through `maxDeposit()` | pre-flight → DEFER |

Why 104 USDC: a 100 USDC deposit buys 91.65 ixv1, and redeeming all of it returns 99.5 USDC net, below the 100 USDC minimum, so `requestRedeem` reverts with `below min redeem`. Both facts are in the evidence (fork run at block 123779792 and the eth_call redeem simulation). The shares of a 104 USDC deposit (95.32 ixv1) redeem for 103.48 USDC net.

## IXS integration

- **IXS Vault API** (`https://api-v2.ixs.finance/vaults`): vault addresses, route ids, status, whitelist flag, subgraph URLs. No address is hardcoded except a fallback skeleton used when the API is down.
- **IXS MCP** (`https://api-v2.ixs.finance/mcp`): `vault_get` (settlement kind and pricing), `vault_check_whitelist`, `vault_build_request_deposit` (approve exact + deposit / requestDeposit calldata), `vault_build_request_redeem`.
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

Per IXS (answers to participants, 24 Sep 2026): daily cutoff 17:00 SGT (09:00 UTC) on Singapore business days, settlement about one business day later; a deposit limit of 0 is the NAV-staleness effect, not a closed vault; minimum deposit 100 USDC; redemption has no claim step (requested → awaiting RWA sale & operator finalization → paid). Singapore public holidays in the cutoff calculator are assumed, not confirmed by IXS.

## Pre-flight per vault

| Check | Source | Fails → |
|---|---|---|
| Vault status | IXS Vault API `status`, `paused()` | REJECT |
| Eligibility | IXS MCP `vault_check_whitelist`, `whitelistEnabled()` | REJECT |
| NAV freshness | `priceUpdatedAt()` vs 72 h policy and `navStalenessThreshold()` | DEFER |
| Deposit limit | `maxDeposit(wallet)` | DEFER (limit 0 = NAV staleness, per IXS) |
| IXS MCP builds the request | `vault_build_request_deposit` probe | REJECT when the vault is otherwise open |
| Minimum deposit | 100 USDC (IXS) | REJECT |
| Live redeemable minimum | `minRedeemAssets()` + `feeBps()` | REJECT in Live mode, informational in Simulate |
| Cutoff / settlement | IXS statement + subgraph `depositRequests` | informational |

## Evidence

`/evidence` shows, and `GET /api/evidence` exports: the dated IXS and judge statements; every vault with deposit limit, price per share, NAV timestamp, last NAV change transaction and read block (live); the committed snapshot of the latest public demo run (SERV verdicts with input and output, pre-flight per vault, memo, deposit and redeem simulations); the mainnet-fork runs; and the call log of the answering server instance on top of the snapshot's call log, so the page is never empty on a fresh serverless instance.

Committed files in [`evidence/`](evidence):

- `snapshot-2026-09-25.json`: public demo run captured from https://vaulto-five.vercel.app with `npm run evidence:snapshot`.
- `fork-bnb-block123779792-100usdc.json`: 100 USDC → 91.65 ixv1 on a BNB mainnet fork (approve + deposit fork transactions).
- `fork-bnb-block123785153-101usdc-redeem.json`: 101 USDC deposit, then `requestRedeem` queued on the fork.
- `fork-bnb-block123868127.json`, `fork-avalanche-block96093431.json`: 25 Sep 2026 forks, both open vaults at limit 0 → DEFER, licensed vaults → REJECT.

## Revenue model

A routing fee of **25 bps per year on the AUM Vaulto routes into IXS vaults**, taken from vault yield. No fee on idle capital and none on deferred or rejected allocations. Target users: DAO treasuries, crypto startups and small funds that want RWA yield with policy guardrails and an audit trail, without an ops desk watching cutoffs, NAV updates and deposit limits.

## Run it locally

```bash
git clone https://github.com/zkzora/vaulto && cd vaulto
cp .env.example .env        # add OPENSERV_API_KEY (serv_…)
npm install
npm run dev                 # http://localhost:3000
```

Open **Launch Vaulto → Continue with demo treasury** (Acme DAO, labelled "Simulated treasury"), then **Run analysis**.

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
- On Vercel the JSON store and the call log live in memory per serverless instance; the execute flow is stateless and `/evidence` falls back to the committed snapshot. Set `DATABASE_URL` for persistence.
- The IXS MCP tool `vault_request_status` currently fails upstream with a schema error; request status is read from the IXS subgraph instead.
