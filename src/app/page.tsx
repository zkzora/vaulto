import Image from "next/image";
import Link from "next/link";
import { Icons, IxsMark, OpenServBadge, VaultoLogo } from "@/components/ui";

const STEPS = [
  ["Connect wallet", "Read-only by default."],
  ["Scan treasury", "Treasury Scanner Agent reads assets and liquidity."],
  ["Detect idle capital", "Opportunity Finder scores inefficiency."],
  ["Recommend strategy", "Risk Guardian + Allocation Planner, in plain language."],
  ["Approve", "Nothing moves without your signature."],
  ["Execute", "Simulated on mainnet by default; Live is opt-in and wallet-signed."],
  ["Monitor", "Monitoring Agent tracks outcomes."],
];

const FEATURES = [
  {
    title: "AI reasoning you can read",
    body: "OpenServ Reasoning writes the why for every recommendation: what was compared, what was rejected, and what changes if you say yes.",
    icon: Icons.spark,
  },
  {
    title: "Risk management built in",
    body: "A single treasury health score plus liquidity, vault and exposure limits you set once and Vaulto never crosses.",
    icon: Icons.shield,
  },
  {
    title: "Licensed IXS RWA strategies",
    body: "Only IXS vaults listed by the IXS Vault API: IX High Yield Bond on BNB Chain and Avalanche, open and licensed, each with yield, deposit limit, NAV age and eligibility up front.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3F73DA" strokeWidth="1.8" strokeLinecap="round">
        <path d="M4 18h16M6 14V9M11 14V6M16 14v-4" />
      </svg>
    ),
  },
  {
    title: "NAV and limit watcher",
    body: "The Monitoring Agent watches every IXS vault's deposit limit and NAV updates, and flags when a deferred vault reopens.",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3F73DA" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
  },
];

function Eyebrow({ children, light }: { children: React.ReactNode; light?: boolean }) {
  return <div className={`text-[13px] font-semibold uppercase tracking-[0.08em] ${light ? "text-sky" : "text-blue-deep"}`}>{children}</div>;
}

export default function Landing() {
  return (
    <div className="bg-white">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-line-2 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-[76px] max-w-[1312px] items-center justify-between px-6 lg:px-16">
          <Link href="/" aria-label="Vaulto">
            <VaultoLogo height={26} />
          </Link>
          <nav className="hidden gap-8 text-[15px] font-semibold text-slate md:flex">
            <a href="#features" className="hover:text-ink">Product</a>
            <a href="#how" className="hover:text-ink">How it works</a>
            <a href="#revenue" className="hover:text-ink">Revenue</a>
            <a href="#security" className="hover:text-ink">Security</a>
            <a href="#architecture" className="hover:text-ink">Docs</a>
          </nav>
          <div className="flex gap-2.5">
            <Link href="/connect" className="btn btn-ghost hidden h-11 rounded-xl px-4 text-[15px] text-ink sm:inline-flex">Sign in</Link>
            <Link href="/connect" className="btn btn-primary h-11 rounded-xl px-5 text-[15px]">Launch Vaulto</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative px-6 pt-20 text-center lg:px-16 lg:pt-24" style={{ background: "radial-gradient(900px 480px at 50% 0%, #EAF1FE 0%, rgba(234,241,254,0) 70%)" }}>
        <span className="inline-flex h-8 items-center gap-2 rounded-full bg-tint px-3.5 text-[13px] font-semibold text-blue-deep">Powered by OpenServ Reasoning · Built with IXS Agent Rail</span>
        <h1 className="mx-auto mt-6 max-w-[900px] font-display text-[44px] font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[56px] lg:text-[68px]" style={{ textWrap: "balance" }}>
          Find idle capital. Deploy smarter.
        </h1>
        <p className="mx-auto mt-6 max-w-[620px] text-[18px] leading-[1.55] text-body lg:text-[20px]" style={{ textWrap: "pretty" }}>
          Vaulto analyzes your treasury, finds unused capital, and recommends optimized IXS RWA strategies powered by OpenServ reasoning.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link href="/connect" className="btn btn-primary btn-lg">Launch Vaulto</Link>
          <Link href="/evidence" className="btn btn-soft btn-lg">See the evidence</Link>
        </div>
        <p className="mx-auto mt-5 max-w-[640px] text-[13px] leading-[1.55] text-muted">
          Submission mode: <b className="text-ink">Simulated on BNB mainnet</b>. Deposits built by the IXS MCP run through eth_call with a state override against the real IXS vaults; nothing is sent. Live mode is an opt-in capability, not executed in this submission.
        </p>

        {/* Product preview */}
        <div className="mx-auto mb-16 mt-16 max-w-[1120px] overflow-hidden rounded-[20px] border border-line bg-canvas text-left shadow-hero lg:mb-[72px]">
          <div className="flex h-10 items-center gap-1.5 border-b border-line bg-white px-4">
            <span className="h-2.5 w-2.5 rounded-full bg-line" />
            <span className="h-2.5 w-2.5 rounded-full bg-line" />
            <span className="h-2.5 w-2.5 rounded-full bg-line" />
            <span className="ml-3.5 text-[12px] font-medium text-faint">Illustration · simulated treasury</span>
          </div>
          <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[1.1fr_1fr]">
            <div className="card p-[22px]">
              <div className="eyebrow">Total treasury</div>
              <div className="mt-2 font-display text-[40px] font-semibold leading-none tracking-[-0.02em] text-ink">$2,483,020</div>
              <div className="mt-2 text-[14px] font-semibold text-green">+$4,812 this week</div>
              <div className="mt-5 grid grid-cols-3 gap-3">
                {[
                  ["Current yield", "2.0%", "text-ink"],
                  ["Idle", "54%", "text-amber"],
                  ["Health", "87", "text-green"],
                ].map(([l, v, c]) => (
                  <div key={l} className="stat-tile">
                    <div className="text-[12px] font-medium text-muted">{l}</div>
                    <div className={`mt-1 font-display text-[20px] font-semibold ${c}`}>
                      {v}
                      {l === "Health" && <span className="text-[13px] text-faint">/100</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="card-accent p-[22px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-blue-deep">Vaulto recommends</span>
                <OpenServBadge />
              </div>
              <div className="mt-2.5 font-display text-[20px] font-semibold leading-[1.3] tracking-[-0.01em] text-ink">Allocate idle capital into IXS RWA strategies</div>
              <div className="mt-2 text-[14px] leading-[1.5] text-body">
                Your treasury has idle capital. Based on your liquidity floor and risk policy, Vaulto recommends moving part of the USDC runway into the IX High Yield Bond (IXHYB) vault on IXS while keeping two months of burn liquid.
              </div>
              <div className="mt-4 flex gap-2.5">
                <Link href="/connect" className="btn btn-primary">Review strategy</Link>
                <a href="#architecture" className="btn btn-soft">Why?</a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Powered by */}
      <section className="bg-navy px-6 py-9 lg:px-16">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-center gap-8 lg:gap-14">
          <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-sky">Powered by</span>
          <span className="inline-flex items-center gap-3.5">
            <Image src="/brand/openserv-wordmark-light.png" alt="OpenServ" width={130} height={30} style={{ height: 30, width: "auto" }} />
            <span className="text-[12px] font-medium text-cloud">Reasons · Scanner, Finder, Risk and Planner agents</span>
          </span>
          <span className="hidden h-9 w-px bg-white/15 lg:block" />
          <span className="inline-flex items-center gap-3">
            <IxsMark size={36} />
            <span className="grid">
              <span className="font-display text-[18px] font-semibold tracking-[-0.01em] text-white">IXS</span>
              <span className="text-[12px] font-medium text-cloud">Executes · Agent Rail / MCP · RWA vaults</span>
            </span>
          </span>
        </div>
      </section>

      {/* Problem */}
      <section className="mx-auto max-w-[1120px] px-6 pt-24 lg:px-16 lg:pt-28">
        <Eyebrow>The problem</Eyebrow>
        <h2 className="mt-3.5 max-w-[720px] font-display text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink lg:text-[44px]">Treasury capital shouldn&apos;t sit still.</h2>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <div className="grid content-start gap-4 rounded-[20px] bg-canvas p-8">
            <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-faint">Before Vaulto</div>
            <div className="font-display text-[24px] font-semibold tracking-[-0.01em] text-ink">Assets sit idle</div>
            {["Idle treasury capital", "Manual strategy research", "Difficult risk evaluation", "No continuous monitoring"].map((t) => (
              <div key={t} className="flex items-center gap-3 text-[16px] font-medium text-body">
                <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-line-3 text-faint">{Icons.x}</span>
                {t}
              </div>
            ))}
          </div>
          <div className="grid content-start gap-4 rounded-[20px] bg-navy p-8">
            <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-sky">After Vaulto</div>
            <div className="font-display text-[24px] font-semibold tracking-[-0.01em] text-white">Capital works, you decide</div>
            {["Detect opportunities", "Explain decisions", "Allocate through IXS", "Monitor outcomes"].map((t) => (
              <div key={t} className="flex items-center gap-3 text-[16px] font-medium text-white">
                <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-green-tint text-green">{Icons.check}</span>
                {t}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-[1120px] scroll-mt-24 px-6 pt-24 lg:px-16 lg:pt-32">
        <Eyebrow>How it works</Eyebrow>
        <h2 className="mt-3.5 font-display text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink lg:text-[44px]">Seven steps. You keep the keys.</h2>
        <div className="mt-12 grid grid-cols-2 border-t border-line sm:grid-cols-4 lg:grid-cols-7">
          {STEPS.map(([title, body], i) => (
            <div key={title} className={`px-4 pt-7 ${i % 7 !== 6 ? "lg:border-r lg:border-line" : ""} ${i === 0 ? "pl-0" : ""}`}>
              <div className="font-display text-[36px] font-semibold leading-none tracking-[-0.03em] text-blue">{i + 1}</div>
              <div className="mt-3.5 font-display text-[15px] font-semibold leading-[1.3] text-ink">{title}</div>
              <div className="mt-1.5 text-[13px] leading-[1.5] text-body">{body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Architecture */}
      <section id="architecture" className="mx-auto max-w-[1120px] scroll-mt-24 px-6 pt-24 lg:px-16 lg:pt-32">
        <Eyebrow>How it fits together</Eyebrow>
        <h2 className="mt-3.5 font-display text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink lg:text-[44px]">OpenServ reasons. IXS executes. Vaulto orchestrates.</h2>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          <div className="card rounded-[20px] p-7">
            <div className="flex items-center justify-between">
              <span className="pill h-6 bg-canvas px-2.5 text-[12px] tracking-[0.04em] text-muted">INTELLIGENCE</span>
              <OpenServBadge size="md" />
            </div>
            <div className="mt-4 font-display text-[22px] font-semibold tracking-[-0.01em] text-ink">OpenServ Reasoning</div>
            <div className="mt-2 text-[15px] leading-[1.55] text-body">Reads treasury objectives, evaluates risk and explains every recommendation in plain language. Six agents: Scanner, Finder, Risk Guardian, Planner, Execution, Monitoring.</div>
          </div>
          <div className="card rounded-[20px] p-7">
            <div className="flex items-center justify-between">
              <span className="pill h-6 bg-canvas px-2.5 text-[12px] tracking-[0.04em] text-muted">EXECUTION</span>
              <IxsMark size={26} />
            </div>
            <div className="mt-4 font-display text-[22px] font-semibold tracking-[-0.01em] text-ink">IXS RWA Vaults</div>
            <div className="mt-2 text-[15px] leading-[1.55] text-body">Licensed vault infrastructure and strategy access. Deposits are built by the IXS MCP; every strategy is a real IXS vault on BNB Chain or Avalanche mainnet, listed by the IXS Vault API.</div>
          </div>
          <div className="card rounded-[20px] p-7">
            <div className="flex items-center justify-between">
              <span className="pill h-6 bg-canvas px-2.5 text-[12px] tracking-[0.04em] text-muted">ORCHESTRATION</span>
              <VaultoLogo height={16} />
            </div>
            <div className="mt-4 font-display text-[22px] font-semibold tracking-[-0.01em] text-ink">Vaulto</div>
            <div className="mt-2 text-[15px] leading-[1.55] text-body">Connects treasury analysis, strategy recommendation, your approval and capital allocation in one operating system. Non-custodial: simulated by default, and in Live mode your wallet signs every transaction.</div>
          </div>
        </div>
        <div className="mt-6 overflow-x-auto rounded-[20px] border border-line bg-canvas px-6 py-5">
          <div className="flex min-w-[900px] items-center justify-between gap-2 text-[12px] font-semibold text-slate">
            {["User wallet", "Vaulto web app", "Agent orchestrator", "OpenServ reasoning", "Multi-agent decision", "IXS adapter", "IXS Agent Rail / MCP", "Vault infrastructure", "Wallet signs"].map((n, i, arr) => (
              <span key={n} className="flex items-center gap-2">
                <span className="rounded-lg border border-line bg-white px-2.5 py-1.5 whitespace-nowrap">{n}</span>
                {i < arr.length - 1 && <span className="text-faint">→</span>}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-[1120px] scroll-mt-24 px-6 pt-24 lg:px-16 lg:pt-32">
        <Eyebrow>Features</Eyebrow>
        <h2 className="mt-3.5 font-display text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink lg:text-[44px]">An operator, not a dashboard.</h2>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="grid gap-3.5 rounded-[20px] border border-line p-8">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-tint text-blue-deep">{f.icon}</div>
              <div className="font-display text-[22px] font-semibold text-ink">{f.title}</div>
              <div className="text-[15px] leading-[1.55] text-body">{f.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Revenue model */}
      <section id="revenue" className="mx-auto max-w-[1120px] scroll-mt-24 px-6 pt-24 lg:px-16 lg:pt-32">
        <Eyebrow>Revenue model</Eyebrow>
        <h2 className="mt-3 font-display text-[32px] font-semibold tracking-[-0.02em] text-ink lg:text-[40px]">A routing fee on the capital Vaulto puts to work</h2>
        <p className="mt-4 max-w-[720px] text-[16px] leading-[1.6] text-body">
          Vaulto charges a small annual fee in basis points on the assets it routes into IXS vaults (AUM routed), taken from the yield the vaults pay out. No fee on idle capital, no fee when SERV reasoning defers or rejects. The vaults&apos; own terms stay untouched: 0% deposit fee, 0.5% redemption fee to IXS.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            ["25 bps / year", "on routed AUM", "Taken from the vault yield (3.07% TTM today), so the treasury keeps ~2.8% net."],
            ["$1M routed → $2,500 / yr", "$10M routed → $25,000 / yr", "$50M routed → $125,000 / yr. Fee scales with what is actually deployed, not with what sits idle."],
            ["Who pays for it", "DAO treasuries, crypto startups, small funds", "Teams that want RWA yield with policy guardrails and an audit trail, without an ops desk watching cutoffs, NAV updates and deposit limits."],
          ].map(([t, s, b]) => (
            <div key={t} className="rounded-2xl border border-line bg-white p-6">
              <div className="font-display text-[22px] font-semibold text-ink">{t}</div>
              <div className="mt-1 text-[13px] font-semibold text-blue-deep">{s}</div>
              <div className="mt-2 text-[14px] leading-[1.55] text-body">{b}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 text-[13px] text-muted">Every decision, deferral and rejection is logged with the SERV reasoning that produced it (see /evidence), which is the product: an allocation desk that explains itself.</div>
      </section>

      {/* Security */}
      <section id="security" className="mt-24 scroll-mt-24 bg-navy px-6 py-20 text-white lg:mt-32 lg:px-16 lg:py-24">
        <div className="mx-auto grid max-w-[1120px] items-start gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <Eyebrow light>Security</Eyebrow>
            <h2 className="mt-3.5 font-display text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] lg:text-[44px]" style={{ textWrap: "balance" }}>
              Non-custodial. Every action approved by you.
            </h2>
            <p className="mt-5 max-w-[460px] text-[17px] leading-[1.6] text-cloud">Vaulto is an agent with a voice, not a wallet with your keys. OpenServ proposes, IXS prepares the transaction, your wallet signs.</p>
          </div>
          <div className="grid gap-4">
            {[
              ["Funds stay in your wallet", "Vaulto holds no assets and no signing keys. Revoke access any time."],
              ["Approval workflow", "Each transaction is reviewed with amount, destination, yield and risk before you sign."],
              ["Full transparency", "SERV input and output, pre-flight facts with block numbers and simulation results are public on the Evidence page."],
            ].map(([t, b]) => (
              <div key={t} className="rounded-2xl border border-white/10 bg-white/[0.06] px-6 py-[22px]">
                <div className="font-display text-[18px] font-semibold">{t}</div>
                <div className="mt-1.5 text-[15px] leading-[1.5] text-cloud">{b}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-24 text-center lg:px-16 lg:py-28">
        <h2 className="font-display text-[36px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink lg:text-[48px]">Put your treasury to work.</h2>
        <p className="mx-auto mt-4 max-w-[480px] text-[18px] leading-[1.5] text-body">Connect your treasury wallet and get your first strategy in under five minutes.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/connect" className="btn btn-primary btn-lg">Launch Vaulto</Link>
          <Link href="/evidence" className="btn btn-soft btn-lg">See the evidence</Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="mx-auto max-w-[1248px] border-t border-line px-6 pb-10 pt-12 lg:px-16">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <VaultoLogo height={22} />
            <div className="mt-3 max-w-[260px] text-[14px] leading-[1.5] text-muted">AI Treasury Operating System for on-chain treasuries. Powered by OpenServ Reasoning and IXS RWA vaults.</div>
          </div>
          {(
            [
              ["Product", [["App", "/app"], ["Strategy", "/app/strategy"], ["IXS vaults", "/app/vaults"], ["Risk Center", "/app/risk"]]],
              ["Proof", [["Evidence", "/evidence"], ["Evidence JSON", "/api/evidence"], ["Source code", "https://github.com/zkzora/vaulto"]]],
              ["Built on", [["OpenServ", "https://openserv.ai"], ["IXS Finance", "https://ixs.finance"], ["IXS Vault API", "https://api-v2.ixs.finance/vaults"]]],
            ] as [string, [string, string][]][]
          ).map(([h, items]) => (
            <div key={h} className="grid content-start gap-2.5 text-[14px] font-medium text-body">
              <div className="text-[13px] font-semibold text-ink">{h}</div>
              {items.map(([label, href]) =>
                href.startsWith("http") ? (
                  <a key={label} href={href} target="_blank" rel="noreferrer" className="hover:text-ink">
                    {label}
                  </a>
                ) : (
                  <Link key={label} href={href} className="hover:text-ink">
                    {label}
                  </Link>
                ),
              )}
            </div>
          ))}
        </div>
        <div className="mt-10 max-w-[880px] text-[12px] leading-[1.6] text-faint">
          Vaulto is software that proposes transactions to wallets you control. Intelligence by OpenServ Reasoning; vault access through IXS Agent Rail. It does not custody assets or provide investment advice. Yields shown are variable; the treasury on this page is an illustration. Submission mode: simulated on mainnet (no Live deposit executed). © 2026 Vaulto.
        </div>
      </footer>
    </div>
  );
}
