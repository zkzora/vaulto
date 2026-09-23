"use client";

import { AgentActivityList } from "@/components/dashboard/agent-activity";
import { useActivity } from "@/hooks/use-vaulto";
import { fmtTime, fmtShortDate, fmtUsd, shortAddress } from "@/lib/format";
import { Card, CardTitle, ErrorState, Icons, Pill, Skeleton } from "@/components/ui";

const statusTone = (s: string) => (s === "confirmed" ? "green" : s === "simulated" ? "blue" : s === "failed" ? "red" : "muted");

export default function ActivityPage() {
  const q = useActivity();
  if (q.isError) return <ErrorState message={q.error.message} retry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96" />;
  const { logs, transactions } = q.data;

  return (
    <div className="grid content-start gap-5">
      <div>
        <div className="font-display text-[28px] font-semibold tracking-[-0.02em] text-ink">Activity</div>
        <div className="mt-1 text-[14px] text-muted">Every agent decision and every transaction, logged with reasoning and on-chain hashes.</div>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardTitle action={<span className="text-[12px] font-medium text-faint">{logs.length} entries</span>}>Agent log</CardTitle>
          <div className="mt-2 max-h-[640px] overflow-y-auto pr-1">
            <AgentActivityList logs={logs} />
          </div>
        </Card>
        <Card>
          <CardTitle action={<span className="text-[12px] font-medium text-faint">{transactions.length} transactions</span>}>Transactions</CardTitle>
          <div className="mt-2 overflow-x-auto">
            <div className="min-w-[560px]">
              <div className="table-head" style={{ gridTemplateColumns: "1.5fr 1fr .9fr .9fr 1fr" }}>
                <span>Action</span>
                <span>Strategy</span>
                <span>Amount</span>
                <span>Status</span>
                <span>Hash</span>
              </div>
              {transactions.map((t) => (
                <div key={t.id} className="table-row text-ink" style={{ gridTemplateColumns: "1.5fr 1fr .9fr .9fr 1fr" }}>
                  <div>
                    <div className="font-semibold capitalize">{t.kind === "requestDeposit" ? "Request deposit" : t.kind}</div>
                    <div className="text-[12px] font-normal text-faint">
                      {fmtShortDate(t.createdAt)} · {fmtTime(t.createdAt)}
                    </div>
                  </div>
                  <span className="text-[13px]">{t.strategy}</span>
                  <span className="font-display text-[14px] font-semibold">{fmtUsd(t.amountUsd)}</span>
                  <span>
                    <Pill tone={statusTone(t.status)} className="capitalize">{t.status}</Pill>
                  </span>
                  {t.explorerUrl ? (
                    <a href={t.explorerUrl} target="_blank" rel="noreferrer" className="mono inline-flex items-center gap-1 text-blue-deep">
                      {shortAddress(t.hash, 4)} {Icons.external}
                    </a>
                  ) : (
                    <span className="mono text-faint">{t.hash ? `${shortAddress(t.hash, 4)} · sim` : "—"}</span>
                  )}
                </div>
              ))}
              {!transactions.length && <div className="py-8 text-center text-[13px] text-muted">No transactions yet. Approve a strategy to prepare one through IXS Agent Rail.</div>}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
