# Vaulto — AI treasury allocation agent for IXS RWA vaults

Vaulto scans a DAO / Web3 company treasury, finds idle capital and allocates it into the **IX High Yield Bond vault on BNB Chain mainnet** through the IXS Agent Rail. OpenServ (SERV reasoning) decides and explains every allocation; the user approves; nothing moves without the wallet's signature.

Built for the OpenServ SERV Hackathon, **RWA Vaults powered by IXS Finance** track.

## What runs where

| Layer | Implementation |
|---|---|
| Frontend | Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 |
| Wallet | RainbowKit + wagmi + viem, browser wallets via EIP-6963 (MetaMask, Rabby, …), BNB Chain (56) |
| Reasoning | OpenServ Inference API (`OPENSERV_API_KEY`), six agents: Treasury Scanner, Opportunity Finder, Risk Guardian, Allocation Planner, Execution, Monitoring |
| Vaults | IXS production Vault API (`api-v2.ixs.finance`) + IXS MCP (`vault_get`, `vault_check_whitelist`, `vault_build_request_deposit`, `vault_request_status`) |
| Execution | **Simulated on BNB mainnet** (eth_call + state override) or **Live** (wallet-signed) or **Mainnet fork** (Anvil) — always against the real IXS contracts |
| Data | PostgreSQL via Prisma, or a JSON file store when `DATABASE_URL` is empty |

No mock tokens and no mock vaults: the only contracts Vaulto touches are the IXS vaults and the USDC they hold.

## Quick start

```bash
cd web
cp .env.example .env        # add OPENSERV_API_KEY
npm install
npm run dev
```

Open `http://localhost:3000` → **Launch Vaulto** → connect a browser wallet on BNB Chain, or **Continue with demo treasury** (Acme DAO).

## Execution modes (honest labels everywhere)

| Mode | When | What happens on **Approve** |
|---|---|---|
| **Simulated on BNB mainnet** | wallet holds < 100 USDC (default, demo treasury) | The approve + deposit calldata built by the IXS MCP is run through `eth_call` on BNB mainnet with a **state override** (USDC balance + allowance of the wallet). The modal shows the expected shares (decoded from the call and cross-checked with `previewDeposit`), gas estimate, price per share, or the decoded revert reason. Nothing is sent. |
| **Live · BNB Chain** | wallet holds ≥ 100 USDC | Same calldata, signed by the wallet: `approve` then `deposit` into the vault. Hashes land in Activity with BscScan links. Switches on automatically. |
| **Mainnet fork** | `RPC_URL=http://127.0.0.1:8545` (Anvil) | Same flows against a local fork of BNB mainnet; the topbar says "Mainnet fork". |

The Strategy page, transaction modal, Activity log and topbar carry the mode label; a simulated step never gets a fake hash.

## The vault (nothing hardcoded)

- Addresses come from `GET https://api-v2.ixs.finance/vaults` (chain 56, product `ixhyb`); `src/lib/chain/config.ts` keeps them only as a last-known fallback for when the API is down.
- `asset()`, the asset's `decimals()`/`symbol()`, share `decimals()`, `feeBps()`, `whitelistEnabled()`, `paused()`, `totalAssets()`, `totalSupply()` and price per share are read from the contracts on every registry refresh (`src/lib/ixs/registry.ts`). Settlement (sync ERC-4626 vs async ERC-7540) comes from the IXS MCP `vault_get`.
- Two BNB Chain vaults are listed: the **open** IX High Yield Bond vault (`ixv1`, sync, no whitelist) is the executable target; the **licensed** one (`ix7540v1`, async ERC-7540, KYC whitelist) is checked live through `vault_check_whitelist` and rejected with the reason when the wallet is not whitelisted. BTC Real Yield stays in the catalog as announced / not deployable.
- Terms shown in the Risk Center and IXS Strategies page: minimum deposit 100 USDC (enforced by the Risk Guardian, Planner and SERV prompt), 0% deposit fee, **0.5% redemption fee read from `feeBps()`**, redemption requests anytime and processed per cycle (as fast as T+1, per IXS).

## Mainnet fork script (for the video)

```bash
npm run fork:demo            # or: KEEP=1 npm run fork:demo   to leave Anvil running for the app
```

`scripts/fork-demo.mjs` starts Anvil as a fork of BNB mainnet, resolves the vault from the IXS API, reads `asset()`/`decimals()`, impersonates a USDC whale to fund the demo wallet with 100 USDC, asks the IXS MCP for the approve + deposit calldata, sends both from the demo wallet, and prints shares received, price per share and whether the deposit settled synchronously (ERC-4626) or, for async vaults, the request status (`pendingDepositRequest` / MCP `vault_request_status`). Requires Foundry (`anvil`); set `ANVIL_BIN` if it is not on PATH.

## How an allocation is decided

1. **Treasury Scanner** reads BNB, USDC (as `asset()` of the vault) and vault shares in one Multicall3 round-trip, layers the optional demo profile, detects idle capital.
2. **Opportunity Finder** matches idle assets to the catalog; announced products are surfaced as unavailable.
3. **Risk Guardian** checks vault availability (IXS Vault API), eligibility (IXS MCP), minimum deposit, risk score, liquidity floor and exposure.
4. **Allocation Planner** computes hard caps (liquidity floor + burn buffer, stablecoin runway reserve, minimum deposit).
5. **SERV reasoning** (OpenServ) decides the legs within the caps and writes the explanation; the Planner validates and clamps. Local sizing only as fallback when OpenServ is down, labelled as such.
6. **Execution Agent** builds calldata via the IXS MCP and either simulates it (eth_call + state override) or hands it to the wallet.
7. **Monitoring Agent** scores health, exposure (real 30-day BTC volatility), strategy deviation and vault terms.

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/treasury?address=` | Snapshot (on-chain + demo layer), execution mode, open recommendation |
| GET | `/api/vaults` | Catalog from the registry (API addresses + contract reads) and every IXS production vault |
| GET | `/api/ixs/mainnet` | Read-only view of all IXS production vaults (BNB Chain + Avalanche) |
| POST | `/api/analyze` | Full pipeline → recommendation |
| GET/POST/PATCH | `/api/recommendation` | Latest / generate / dismiss-reject |
| POST | `/api/execute` | Prepare: MCP calldata + simulation (or unsigned txs in Live mode); `simulate: true` forces a simulation |
| PUT | `/api/execute` | Finalize: record signed / simulated outcomes |
| GET | `/api/risk`, `/api/portfolio`, `/api/activity`, `/api/settings` | Reports, logs, policy |

## Scripts

- `npm run dev` / `npm run build` / `npm run lint`
- `npm run fork:demo` — Anvil mainnet-fork walkthrough (above)
- `npm run agent` — run Vaulto as an OpenServ platform agent (platform reasoning mode)
- `npm run db:push` — Prisma schema to PostgreSQL

## Security model

- Vaulto holds no keys and never signs. The IXS MCP builds calldata; the wallet signs in Live mode; simulations are read-only `eth_call`s.
- Every proposal shows amount, destination, expected outcome, risk score, liquidity after, fees and the execution mode before approval.
- Reasoning source (OpenServ vs local), confidence, simulation results and transaction hashes are logged in Activity.
