# Typeform answers (ready to paste)

Replace `VIDEO_URL` and `X_POST_URL` after the video and the post are published.

## Project name

Vaulto

## Track

RWA Vaults powered by IXS Finance

## One-line description

An AI treasury agent that finds idle DAO capital and routes it into IXS RWA vaults on BNB Chain and Avalanche; SERV reasoning decides every allocation and deterministic guardrails enforce the hard limits.

## Short description (≈ 50 words)

Vaulto scans a treasury, finds idle stablecoins and runs a pre-flight on every IXS vault: deposit limit, NAV age, whitelist, minimum, cutoff. SERV reasoning gives each vault ALLOCATE, DEFER or REJECT with a reason and writes a committee memo. Deposits built by the IXS MCP are simulated on BNB mainnet; every fact is public.

## Long description

DAO and startup treasuries often leave large stablecoin balances idle because moving them into RWA yield means watching deposit limits, NAV updates, cutoffs, KYC gates and minimums by hand. Vaulto is an agent that does that work and explains every decision.

For each treasury, six agents run in sequence. The Treasury Scanner reads balances on BNB Chain and Avalanche; the Opportunity Finder matches idle assets to the IX High Yield Bond vaults listed by the IXS Vault API; the Risk Guardian runs a pre-flight on every vault from the IXS MCP, the contracts and the IXS subgraphs, with block numbers; the Allocation Planner computes caps from the policy; SERV reasoning (OpenServ) decides one verdict per vault; the Execution Agent turns an approved plan into the exact approve and deposit calldata built by the IXS MCP.

Verdicts follow what IXS told participants on 24 Sep 2026: a deposit limit of 0 is NAV staleness, so the vault is deferred ("temporarily paused — waiting NAV refresh"), not rejected; the minimum deposit is 100 USDC; the daily cutoff is 17:00 SGT; redemption is request → operator finalization → paid, with no claim step. Licensed vaults are rejected when the wallet is not whitelisted, and announced-but-undeployed products (BTC Real Yield) are rejected with that reason.

The submission is simulated, which the judges confirmed is accepted. Approve and execute runs the IXS MCP calldata through eth_call with a state override against the real vault on BNB mainnet, so anyone can see the expected shares from an empty wallet; nothing is sent. Anvil mainnet-fork runs show the same calldata executing on a fork. Live mode is built and opt-in (exact-amount approvals, 150 USDC cap per transaction, 104 USDC minimum so the position stays redeemable after the 0.5% fee) but was not executed for this submission.

Everything is auditable: the public evidence page shows every IXS MCP call, every on-chain read with its block, the NAV history, SERV's exact input and raw output, the simulations and the fork runs, and exports them as JSON. A snapshot of the public demo run is committed to the repository.

## Links

- Live demo: https://vaulto-five.vercel.app (Launch Vaulto → Continue with demo treasury; no wallet needed)
- Evidence: https://vaulto-five.vercel.app/evidence (JSON: https://vaulto-five.vercel.app/api/evidence)
- Source code: https://github.com/zkzora/vaulto
- Demo video: VIDEO_URL
- X post: X_POST_URL

## How does the project use SERV / OpenServ?

SERV reasoning, through the OpenServ Inference API, makes every allocation decision. Each analysis makes two calls. The first receives every candidate vault with its pre-flight facts, the planner's caps and the guardrails, and returns one verdict per vault (ALLOCATE with an amount, DEFER or REJECT) with a reason that cites the facts. The second writes the explanation and a seven-section allocation memo. The exact input and raw output of both calls are stored with the recommendation and shown in the app and on the public evidence page. Deterministic guardrails (liquidity floor, exposure cap, minimum vault score, 100 USDC minimum, 104 USDC Live minimum, 150 USDC Live cap, NAV staleness) sit around SERV; a validator override is logged and counted, and the demo runs needed none. If OpenServ is unreachable, a deterministic fallback runs and is labelled "local".

## How does the project integrate IXS?

- IXS Vault API for vault addresses, status, whitelist flags and subgraph URLs (nothing hardcoded beyond a fallback skeleton).
- IXS MCP tools `vault_get`, `vault_check_whitelist`, `vault_build_request_deposit` and `vault_build_request_redeem`: the deposit and redeem calldata Vaulto simulates and would ask the wallet to sign always comes from the MCP.
- Vault contracts on BNB Chain and Avalanche: `asset()`, `decimals()`, `maxDeposit()`, `priceUpdatedAt()`, `navStalenessThreshold()`, `minRedeemAssets()`, `feeBps()`, `previewDeposit()`, `previewRedeem()`, read with block numbers.
- IXS Goldsky subgraphs for NAV history (transactions verified on-chain) and request lifecycle.
- The IXS answers of 24 Sep 2026 (cutoff, limit 0 = NAV staleness, 100 USDC minimum, redemption without claim) are encoded in the pre-flight and cited on the evidence page.

## Business model

A routing fee of 25 bps per year on the assets Vaulto routes into IXS vaults, taken from vault yield. No fee on idle capital and none on deferred or rejected allocations. Target users are DAO treasuries, crypto startups and small funds that want RWA yield with policy guardrails and an audit trail.

## What is simulated, and what is not

Real: the IXS vault contracts and addresses, the IXS MCP calldata, every on-chain read, the NAV and deposit-limit data, SERV's decisions. Simulated: the Acme DAO treasury balances (labelled "Simulated treasury") and the deposit itself (eth_call with a state override, or an Anvil fork). No Live deposit was executed for this submission.

## Tech stack

Next.js 16, React 19, TypeScript, Tailwind 4, RainbowKit + wagmi + viem, OpenServ Inference API, IXS Vault API + MCP + Goldsky subgraphs, Anvil (Foundry) for mainnet forks, Vercel.
