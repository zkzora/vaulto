# X post draft (thread of 4)

Replace `VIDEO_URL` before posting. Links count as 23 characters each on X; every post below fits in 280.

---

**1/4**

Vaulto: an AI treasury agent that routes idle DAO capital into @IxsFinance RWA vaults, with SERV reasoning from @openservai making every call.

Built for the OpenServ SERV Hackathon, RWA Vaults track. Runs against the real IXS vaults on BNB Chain + Avalanche mainnet. 🧵

**2/4**

How it decides:
• Pre-flight per vault from the IXS MCP + contracts: deposit limit, NAV age, whitelist, 100 USDC minimum, cutoff
• SERV gives each vault ALLOCATE, DEFER (limit 0 = waiting NAV refresh) or REJECT, with the reason
• Deterministic guardrails enforce hard limits

**3/4**

Honest by design: this submission is simulated. Deposits built by the IXS MCP run as eth_call + state override on BNB mainnet, from any wallet, plus Anvil mainnet-fork runs.

Live mode is built (opt-in, exact approvals, 150 USDC cap, 104 USDC floor) but was not executed.

**4/4**

Try it (no wallet needed):
Demo: https://vaulto-five.vercel.app
Evidence: https://vaulto-five.vercel.app/evidence
Code: https://github.com/zkzora/vaulto
Video: VIDEO_URL

Every IXS call, on-chain read with its block, and SERV input/output is public.
