# Vaulto — AI treasury allocation agent for IXS RWA vaults

Vaulto scans a DAO / Web3 company treasury, finds idle capital and routes it into the **IX High Yield Bond (USDC) vaults on BNB Chain and Avalanche mainnet** through the IXS Agent Rail. Every allocation, deferral and rejection is decided by **SERV reasoning (OpenServ)** from pre-flight facts read from the IXS MCP, the vault contracts and the IXS subgraphs; the user approves; nothing moves without the wallet's signature.

Built for the OpenServ SERV Hackathon Edition 01, **RWA Vaults powered by IXS Finance** track.

## What runs where

| Layer | Implementation |
|---|---|
| Frontend | Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 |
| Wallet | RainbowKit + wagmi + viem, browser wallets via EIP-6963, BNB Chain (56) + Avalanche C-Chain (43114) |
| Reasoning | OpenServ Inference API (`OPENSERV_API_KEY`) — six agents: Treasury Scanner, Opportunity Finder, Risk Guardian, Allocation Planner, Execution, Monitoring |
| Vaults | IXS production Vault API (`api-v2.ixs.finance`) + IXS MCP (`vault_get`, `vault_check_whitelist`, `vault_build_request_deposit`) + IXS Goldsky subgraphs (NAV timestamps, minimum deposit, request lifecycle) |
| Execution | **Simulated on <chain> mainnet** (eth_call + state override) · **Live** (wallet-signed, hard cap per tx) · **Mainnet fork** (Anvil) — always against the real IXS contracts |
| Data | PostgreSQL via Prisma, or a JSON file store when `DATABASE_URL` is empty |

No mock tokens, no mock vaults, no cloned contracts: the only addresses in the execution path are the IXS vaults listed by the IXS Vault API and the USDC they hold (read from `asset()`).

## Quick start

```bash
cd web
cp .env.example .env        # add OPENSERV_API_KEY
npm install
npm run dev
```

Open `http://localhost:3000` → **Launch Vaulto** → connect a browser wallet, or **Continue with demo treasury** (Acme DAO, labelled "Simulated treasury"). The public evidence page is at `/evidence`.

## Pre-flight per vault, verdict per vault

On every analysis, each IXS vault gets a pre-flight (`src/lib/ixs/preflight.ts`) with its source and block number:

| Check | Source | Fails → |
|---|---|---|
| Vault status | IXS Vault API `status`, `paused()` on-chain | REJECT |
| Eligibility | IXS MCP `vault_check_whitelist`, `whitelistEnabled()` | REJECT |
| NAV freshness | subgraph `priceUpdatedAt` / `NAV_UPDATED` events (receipt verified on-chain) vs `NAV_STALE_HOURS` (72) | DEFER |
| Deposit limit | `maxDeposit(wallet)` on-chain | DEFER (limit 0 = NAV-staleness effect, per IXS 24 Sep 2026) |
| IXS MCP builds the request | `vault_build_request_deposit` probe | REJECT when the vault is otherwise open |
| Minimum deposit 100 USDC | subgraph `minDepositAssets` / vault revert "below min deposit"; confirmed by IXS | REJECT |
| Cutoff / settlement | IXS statement 24 Sep 2026 + subgraph `depositRequests` | informational |

SERV reasoning receives every candidate with these facts and the Planner's caps and returns **one verdict per vault**: `ALLOCATE` (amount within the cap and deposit limit, may split across open vaults), `DEFER` ("temporarily paused — waiting NAV refresh") or `REJECT`, each with an explicit reason. The Planner validates amounts; a SERV allocation to a vault whose pre-flight failed is overridden and the override is logged. The exact SERV input and raw output are shown on the Strategy page and on `/evidence`.

## Execution modes (honest labels everywhere)

| Mode | When | What **Approve & execute** does |
|---|---|---|
| **Simulated on BNB / Avalanche mainnet** | wallet holds < 100 USDC on that chain (default, simulated treasury) | The approve + deposit calldata built by the IXS MCP runs through `eth_call` on mainnet with a **state override** (USDC balance + allowance of the wallet). Expected shares (decoded and cross-checked with `previewDeposit`), gas estimate, price per share, or the decoded revert reason. Works from any wallet, funded or not. Nothing is sent. |
| **Live · <chain>** | wallet holds ≥ 100 USDC on the vault's chain and pre-flight passes | Same calldata signed by the wallet: `approve` for the exact amount, then `deposit` (sync ERC-4626, shares minted in the tx) or `requestDeposit` (async ERC-7540 → "Request submitted — pending operator settlement"). Hard cap per transaction `MAX_LIVE_TX_USDC`. |
| **Mainnet fork** | `RPC_URL` / `AVAX_RPC_URL` point at a local Anvil | Same flows against a fork; topbar says "Mainnet fork". |

A simulated step never gets a fake hash, and an async request is never called "deposited" until the operator settles it.

## Cutoff-aware, redemption path, watcher

- Per IXS (answer to participants, 24 Sep 2026): daily cutoff **17:00 SGT (09:00 UTC)** on Singapore business days; requests are processed at the next cutoff; settlement ≈ 1 business day. `src/lib/ixs/cutoff.ts` computes the next cutoff and the settlement estimate; Singapore public holidays are marked **assumed, not confirmed by IXS**. The sync BNB vault (`ixv1`) settles in the deposit transaction.
- Redemption: no claim step — **requested → awaiting RWA sale & operator finalization → paid** (USDC sent to the receiver), 0.5% redemption fee read from `feeBps()`.
- NAV / deposit-limit watcher (`src/lib/ixs/watch.ts`): every scan compares the registry with the previous observation; a limit moving from 0 to > 0 or a NAV refresh is logged by the Monitoring Agent, shown in the Risk Center and toasted in the app. Vaults with limit 0 are listed as "waiting NAV refresh".
- Direct contract builds (fallback when the MCP fails for a non-safety reason) are only allowed for the IXS-approved Avalanche proxy `0xaD01573b459805E3954398796203d830B57A8bD9`, and never when the pre-flight did not pass.

## Mainnet fork script (for the video)

```bash
npm run fork:demo                    # BNB Chain fork, every IXS vault on the chain
FORK_CHAIN=43114 npm run fork:demo   # Avalanche fork (vaults with limit 0 are reported as DEFER, nothing built)
KEEP=1 npm run fork:demo             # leave Anvil running, then RPC_URL=http://127.0.0.1:8545
```

`scripts/fork-demo.mjs` reads `asset()`/`decimals()`/`maxDeposit()` from each vault, defers limit-0 vaults, funds the demo wallet from a large USDC holder, asks the IXS MCP for approve + deposit calldata, sends both and reports shares (sync) or "Request submitted — pending operator settlement (fork: IXS operator not present)" (async). Sample output: `docs/fork-demo-sample.json`. Requires Foundry (`anvil`).

## Evidence

`/evidence` (public) and `GET /api/evidence` (JSON export): IXS statements Vaulto relies on (dated), every vault with deposit limit, price per share, NAV timestamp, last NAV change transaction (explorer link, receipt verified) and read block; the next cutoff; the watcher state; the mainnet-fork run; and the call log (IXS MCP requests/responses, Vault API and subgraph reads, on-chain reads with block numbers, eth_call simulations, SERV reasoning input/output).

## Revenue model

A routing fee in basis points per year on the AUM Vaulto routes into IXS vaults (25 bps by default), taken from vault yield; no fee on idle capital or on deferred / rejected allocations. Targets: DAO treasuries, crypto startups and small funds that want RWA yield with policy guardrails and an audit trail, without an ops desk watching cutoffs, NAV updates and deposit limits.

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/treasury?address=` | Snapshot (on-chain per chain + simulated treasury), execution mode, watcher, next cutoff, open recommendation |
| GET | `/api/vaults` | Catalog from the registry (API addresses + contract + subgraph reads) |
| GET | `/api/ixs/mainnet` | Read-only view of all IXS production vaults |
| POST | `/api/analyze` | Full pipeline → verdicts, allocation, memo, trace |
| POST | `/api/simulate` | Pre-flight + IXS MCP calldata + eth_call simulation for one vault (any wallet) |
| POST / PUT | `/api/execute` | Prepare (calldata + simulation, or unsigned txs in Live mode) / finalize |
| GET | `/api/evidence` | Evidence export |
| GET/POST/PATCH | `/api/recommendation`, `/api/risk`, `/api/portfolio`, `/api/activity`, `/api/settings` | Reports, logs, policy |

## Scripts

- `npm run dev` / `npm run build` / `npm run lint`
- `npm run fork:demo` — Anvil mainnet-fork walkthrough
- `npm run agent` — run Vaulto as an OpenServ platform agent (platform reasoning mode)
- `npm run db:push` — Prisma schema to PostgreSQL

## Security model

- Vaulto holds no keys and never signs. The IXS MCP builds calldata; the wallet signs in Live mode; simulations are read-only `eth_call`s.
- Approvals are for the exact deposit amount; Live transactions are capped.
- Every proposal shows amount, destination, expected outcome, risk score, liquidity after, fees, cutoff and the execution mode before approval.
- Reasoning source (OpenServ vs local), confidence, verdicts, simulation results and transaction hashes are logged in Activity and on `/evidence`.
