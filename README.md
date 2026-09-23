# Vaulto Agent

**Find idle capital. Deploy smarter.**

Vaulto is an AI treasury allocation agent. It scans a treasury wallet, detects idle capital, reasons with OpenServ about the best IXS RWA vault strategy under the treasury's own risk policy, and prepares the approved allocation for the user's wallet to sign. Non-custodial end to end.

Hackathon track: RWA Vaults powered by IXS Finance.

## Stack

| Layer | Choice |
| --- | --- |
| Web | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Wallet | RainbowKit + wagmi + viem, browser wallets via EIP-6963 (MetaMask, Rabby, …), BSC Testnet (97) |
| Reasoning | OpenServ Inference API (`serv_…` key), optional OpenServ platform tasks via the SDK tunnel, local fallback engine |
| Execution | IXS Vault API + IXS MCP (`vault_build_request_deposit`, `vault_check_whitelist`) on BSC Testnet, plus Vaulto faucet tokens + IXS-mirror ERC-4626 vaults (real transactions) |
| Data | PostgreSQL via Prisma, or a JSON file store when `DATABASE_URL` is empty |

## Quick start

```bash
cd web
npm install
cp .env.example .env      # defaults work out of the box
npm run dev               # http://localhost:3000
```

Open `http://localhost:3000`, click **Launch Vaulto**, then either connect a browser wallet on BSC Testnet (chain 97) or choose **Continue with demo treasury**. `http://localhost:3000/connect?demo=1` jumps straight into the demo.

### Optional configuration

- **OpenServ reasoning** (no OpenAI account involved): put your OpenServ `serv_…` key in `OPENSERV_API_KEY`. Vaulto sends the multi-agent pipeline facts to the **OpenServ Inference API** (`https://inference-api.openserv.ai/v1`, model `OPENSERV_MODEL`, default `gpt-5.4-mini`), which writes the explanation. Optional platform mode (`OPENSERV_REASONING_MODE=platform`): create a Vaulto agent + workspace on platform.openserv.ai, set `OPENSERV_WORKSPACE_ID`, run `npm run agent`; each analysis then becomes a workspace task completed by the OpenServ runtime. Without a key Vaulto uses its deterministic local engine and labels the source. Restart `npm run dev` after editing `.env`.
- **Testnet faucet + real transactions**: `FAUCET_PRIVATE_KEY` is the faucet/deployer wallet. Fund it with tBNB (BSC Testnet faucet: https://www.bnbchain.org/en/testnet-faucet), then run `npm run deploy:testnet`. This deploys tUSDC and tBTC faucet tokens plus two ERC-4626 vaults mirroring the IXS strategies and writes `deployments/bsc-testnet.json`. Users click **Get test funds** on the Faucet page: the faucet sends 0.0015 tBNB for gas and mints 10,000 tUSDC + 0.25 tBTC (real transactions, 24h cooldown). If the faucet wallet also holds IXS test USDC (IXS mints it; ask the IXS team), 100 ixUSDC is forwarded so the user can deposit into the official IXS vault through the IXS MCP.
- **PostgreSQL**: set `DATABASE_URL`, then run `npm run db:push`. The schema lives in `prisma/schema.prisma` (users, treasury, vault_strategies, recommendations, transactions, agent_logs).
- **WalletConnect**: optional. Set `NEXT_PUBLIC_WC_PROJECT_ID` to add a WalletConnect option; browser wallets work without it.

### Run the Vaulto agent on the OpenServ platform

```bash
OPENSERV_API_KEY=... VAULTO_API_URL=http://localhost:3000 npm run agent
```

`scripts/openserv-agent.mjs` registers the six Vaulto agents as OpenServ capabilities (`scan_treasury`, `list_ixs_strategies`, `analyze_treasury`, `get_recommendation`, `prepare_execution`, `get_activity`). Capabilities call the Vaulto backend; none of them can sign or send a transaction.

## Architecture

```
User wallet (browser wallet, BSC Testnet)
  → Vaulto web app (Next.js)
  → Agent orchestrator            src/lib/orchestrator.ts
  → OpenServ reasoning            src/lib/openserv/reasoning.ts
  → Multi-agent decision system   src/lib/agents/*
  → IXS adapter layer             src/lib/ixs/client.ts, catalog.ts
  → IXS Agent Rail / MCP + Vault API
  → ERC-4626 vault infrastructure
  → Wallet signs (nothing is signed server-side)
```

### Agents (`src/lib/agents`)

| Agent | File | Responsibility |
| --- | --- | --- |
| Treasury Scanner | `scanner.ts` | Reads on-chain balances (tBNB, tUSDC, tBTC, IXS test USDC, vault shares) plus the optional demo profile; detects idle capital; computes health and opportunity scores |
| Opportunity Finder | `finder.ts` | Matches idle assets to IXS strategies and ranks fit |
| Risk Guardian | `risk.ts` | Vault score, eligibility (IXS MCP `vault_check_whitelist`), liquidity floor, exposure policy |
| Allocation Planner | `planner.ts` | Sizes deposits so liquidity stays above the floor and two months of burn; never sells assets |
| Execution | `execution.ts` | Builds unsigned approve + deposit calldata via IXS MCP for IXS vaults, and a local ERC-4626 encoder for the Vaulto mirror vaults |
| Monitoring | `monitoring.ts` | Risk report, alerts, portfolio history |

### IXS integration (BSC Testnet, chain 97)

- Live catalog: `GET https://api-dev-v2.ixs.finance/vaults` filtered to BSC Testnet (shown on the IXS Strategies page).
- MCP: `POST https://api-dev-v2.ixs.finance/mcp`, JSON-RPC 2.0 over Streamable HTTP. Tools used: `vault_check_whitelist`, `vault_build_request_deposit` (returns approve + deposit calldata that the user signs).
- Official IXS vault: **IXHYB - BSC** `0xCb09a5326AEFD705d14FF4C5ca2beD7086ba0Dcc` (sync ERC-4626, open whitelist, asset = IXS test USDC `0xbBCa80a7116aE46B0f249D279EF43f86274dc4f4`). Executable through the IXS MCP when the wallet holds ixUSDC.
- Whitelist-gated IXS vault: **t_ix7540v1** `0x45B962394995e3FbFa83229Fbe97591dEb1DDCc4` (async ERC-7540), surfaced as "Licensed RWA Vault Opportunities" with live eligibility checks.
- Vaulto mirror vaults (Tokenized RWA Yield, BTC Real Yield): plain ERC-4626 contracts deployed by `npm run deploy:testnet`, fed by the Vaulto faucet, so the flow is fully on-chain without IXS test USDC.
- Single-chain config lives in `src/lib/chain/config.ts`.

### Real on-chain flow on BSC Testnet

Connected wallets start with their real balances (demo layer off). **Get test funds** → faucet transactions → **Run analysis** → **Approve** → the wallet signs `approve` + `deposit` (IXS MCP calldata for IXS vaults, ERC-4626 calldata for the mirror vaults) → shares and positions are read back from the chain.

The demo treasury (Acme DAO, **Continue with demo treasury**) still exists for a no-wallet walkthrough: there, legs without an on-chain balance run on a clearly labelled simulated rail. Real wallets can turn the demo layer on in Settings.

### Deployed on BSC Testnet

| Contract | Address |
| --- | --- |
| IXS Hybrid Yield vault (official IXS, read + MCP deposits) | `0xCb09a5326AEFD705d14FF4C5ca2beD7086ba0Dcc` |
| IXS whitelist vault (official IXS, eligibility checks) | `0x45B962394995e3FbFa83229Fbe97591dEb1DDCc4` |
| IXS test USDC (ixUSDC) | `0xbBCa80a7116aE46B0f249D279EF43f86274dc4f4` |
| tUSDC (Vaulto faucet token, 6 dec) | `0x138d831721194999666f864821a709404a9f4461` |
| tBTC (Vaulto faucet token, 8 dec) | `0x44d4df941ca13ffa2ab58633863ab9db996101b1` |
| Tokenized RWA Yield · Vaulto mirror vault (ERC-4626) | `0x7ca05164ccc95c34d322f308446f1d22c0e22a63` |
| BTC Real Yield · Vaulto mirror vault (ERC-4626) | `0x8886401a3ab5bd44503a290a8a24ec6d72a2bebc` |
| Faucet / deployer wallet | `0xCE3963137d2F04b7dDb9c1792a834F0bCe857A7c` |

Verified end to end with `npm run e2e:onchain`: faucet → analysis → approve + deposit into both mirror vaults (signed) → positions read back from chain.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/treasury?address=` | Treasury snapshot + latest recommendation |
| GET | `/api/vaults` | IXS strategies (catalog + live) |
| POST | `/api/analyze` | Run the multi-agent OpenServ reasoning pipeline |
| GET/POST/PATCH | `/api/recommendation` | Fetch, generate, dismiss or reject a recommendation |
| POST | `/api/execute` | Prepare the execution workflow (unsigned calldata) |
| PUT | `/api/execute` | Record signed / simulated outcomes |
| GET | `/api/activity?address=` | Agent logs and transactions |
| GET | `/api/risk?address=` | Risk Center report |
| GET | `/api/portfolio?address=&period=` | Portfolio history and targets |
| GET/PATCH/DELETE | `/api/settings` | Profile, risk policy, demo mode, reset |
| GET/POST | `/api/faucet` | Faucet status / claim tBNB + tUSDC + tBTC (+ ixUSDC when available) |

## Security rules

- No unrestricted autonomous transfers. Every transaction requires the user's wallet signature.
- The review modal shows amount, destination, expected outcome, risk level, liquidity after and execution rail before signing.
- IXS MCP and the local encoder only build calldata. Vaulto holds no keys.
- Every agent decision and every transaction (hash, status) is logged and shown in Activity.

## Demo script

1. Landing page → **Launch Vaulto** → connect a browser wallet (BSC Testnet) or **Continue with demo treasury**.
2. With a wallet: open **Faucet** → **Get test funds** (real faucet transactions on BSC Testnet).
3. Home shows the treasury, idle capital detected and the opportunity score. Click **Run analysis**.
4. The pipeline runs (Scanner → Finder → Risk Guardian → Planner → OpenServ narrative). The recommendation card explains the strategy with confidence and reasons.
5. **Review strategy** shows how Vaulto reasoned, the before/after allocation and what was rejected.
6. **Approve strategy** opens the transaction review. **Execute** signs `approve` + `deposit` in your wallet on BSC Testnet.
7. Home updates: idle capital down, allocation up, health score up. Activity shows the log and transaction hashes.

## Scripts

- `npm run dev` / `npm run build` / `npm run start`
- `npm run db:generate` / `npm run db:push`
- `npm run agent` – start the OpenServ agent server
- `npm run probe:ixs` – probe the IXS vaults and MCP on BSC Testnet
- `node --env-file=.env scripts/probe-openserv.mjs` – verify the OpenServ Inference API key and list models
- `node scripts/compile-contracts.mjs` – compile `contracts/*.sol` with solc
- `npm run deploy:testnet` – deploy faucet tokens + mirror vaults to BSC Testnet
- `npm run e2e:onchain` – full on-chain proof with a throwaway wallet (faucet → analyze → sign → finalize)
