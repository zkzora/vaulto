# Vaulto — demo video script (simulated path, 1:55)

Screen recording of https://vaulto-five.vercel.app with a voice-over, 1920×1080. The scene timings add up to 1:55. No wallet and no funds are needed: the whole video uses the simulated treasury and simulations on BNB mainnet. Every label on screen is honest: "Simulated treasury", "Simulated on BNB mainnet", "Mainnet fork (block N)", "DEFER · waiting NAV refresh". Never say "deposited" or "live deposit".

## Before recording

1. **Check that ixv1 accepts deposits.** Open IXS vaults in the app: the BNB open vault must show a deposit limit above 0, and the topbar must not list it under "waiting NAV refresh". IXS refreshes the ixv1 NAV about every 48 hours (recently around 09:00 SGT on Mon, Wed and Fri); while the NAV is older than the contract's 48 h threshold, `maxDeposit` is 0 and Vaulto correctly defers the vault. If it is deferred, record later or use the fallback at the end.
2. Settings → **Reset demo state**, then leave the policy at its defaults (30% floor, Balanced).
3. Open three tabs: the app on Home, `/evidence`, and a terminal in the repo.
4. In the terminal, run the fork once so the output is ready to show: `AMOUNT=104 REDEEM=1 npm run fork:demo` (needs Foundry's `anvil`). If ixv1 is deferred, show `evidence/fork-bnb-block123779792-100usdc.json` in the editor instead.

## Scenes

| Time | On screen | Voice-over |
|---|---|---|
| 0:00–0:10 | Landing page → **Launch Vaulto** → **Continue with demo treasury**. Topbar pills: "Simulated treasury", "Simulated on BNB + Avalanche mainnet". | "Vaulto is an AI treasury agent for IXS RWA vaults, built on OpenServ. SERV decides; deterministic guardrails enforce the hard limits. It runs against the real IXS vaults on BNB Chain and Avalanche mainnet, and in this submission every deposit is simulated." |
| 0:10–0:22 | Home: total treasury about $2.0M, all of it idle for 23 days (12.4 BTC and about 942,000 USDC). Click **Run analysis**; the agent steps tick through. | "Acme DAO is a simulated treasury: about two million dollars has sat idle for 23 days. One click runs the pipeline: scanner, opportunity finder, the Risk Guardian's pre-flight on every vault, the planner's caps, then SERV reasoning." |
| 0:22–0:31 | Strategy page → **SERV verdicts per vault**. Point at **BTC Real Yield · REJECT**. | "Every vault gets a verdict and a reason. BTC Real Yield is rejected: IXS has announced it, but no vault is deployed." |
| 0:31–0:43 | **Avalanche open vault · DEFER**. Expand its pre-flight: deposit limit 0, NAV from 14 September, older than Vaulto's 72-hour policy. | "The Avalanche vault is deferred, not rejected. Its deposit limit is zero while its NAV is over ten days old, and IXS told participants that a zero limit means temporarily paused, waiting for a NAV refresh. The watcher flags it the moment it reopens." |
| 0:43–0:51 | **Licensed vaults (BNB and Avalanche) · REJECT**. | "The licensed vaults are rejected: the contracts enforce a KYC whitelist, and this wallet is not on it." |
| 0:51–1:04 | **BNB open vault ixv1 · ALLOCATE**, about 572,000 USDC (read the amount on screen). Show the guardrails line and the validator-override count. | "The open BNB vault passes every check, so SERV allocates about 572,000 USDC, the planner's cap after the 30 percent liquidity floor and two months of runway in stablecoins. The override count on screen shows whether the guardrails had to step in." |
| 1:04–1:19 | **Approve & execute (Simulate)**. Modal: "Simulated on BNB mainnet", approve exact + deposit built by the IXS MCP, eth_call with a state override, expected shares (about 524,000 ixv1 at the current price), gas. Run it; the steps turn green. | "Approve runs the exact calldata the IXS MCP built, approve and deposit, through eth_call on BNB mainnet with a state override for the balance and allowance. We get the expected shares and the gas, straight from the real contract. Nothing is sent, and a judge can repeat this from an empty wallet." |
| 1:19–1:31 | Terminal: the fork run from step 4 of the preparation, "Mainnet fork (block N)", approve and deposit confirmed on the fork, shares minted, then `requestRedeem` queued. This needs ixv1 open on the day you prepare it. | "On an Anvil fork of mainnet the same calldata really executes: 104 USDC mints about 95 ixv1, and the redemption request is queued for the operator. Why 104 and not 100? Redeeming the shares of a 100 USDC deposit returns 99.5 after the fee, below the vault's 100 USDC minimum. So Live deposits have a 104 USDC floor." |
| 1:31–1:43 | Back to Strategy → **Allocation memo**: scroll the seven sections (Treasury condition, Policy, Proposed allocation, Deferred, Rejected, Risks, Execution). | "SERV also writes the committee memo in seven sections: the treasury, the policy and guardrails, the allocation, what was deferred or rejected and why, the risks, and how execution works." |
| 1:43–1:55 | `/evidence`: statements from IXS and the judges (dated), vault table with limits, NAV timestamps and blocks, the committed snapshot with SERV input and output, fork runs, **Export JSON**. | "Everything is on a public evidence page: the IXS MCP calls, the on-chain reads with their blocks, SERV's exact input and output, and the fork runs. Live mode is built and capped, but this submission is simulated. Vaulto: SERV decides, guardrails enforce, and the evidence is public." |

## If ixv1 is deferred at recording time

The honest version of the video still works; it only changes three scenes.

- **0:51–1:04**: show **ixv1 · DEFER** and say: "Right now even the BNB vault is deferred: its NAV is 49 hours old, past the contract's 48-hour threshold, so its deposit limit is zero. SERV holds the capital instead of forcing a deposit."
- **1:04–1:19**: on IXS vaults, click **Simulate redeem** on ixv1, or show the committed simulations on `/evidence`: 91.65 ixv1 reverts "below min redeem" and 95.32 ixv1 queues at 103.48 USDC net.
- **1:19–1:31**: show `evidence/fork-bnb-block123779792-100usdc.json` or its card on `/evidence`: "When the NAV was fresh, a fork at block 123,779,792 turned 100 USDC into 91.65 ixv1 with the IXS MCP calldata."
