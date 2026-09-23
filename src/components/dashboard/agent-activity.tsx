import { fmtTime } from "@/lib/format";
import type { AgentLog } from "@/lib/types";
import { Dot } from "@/components/ui";

export function AgentActivityList({ logs, limit }: { logs: AgentLog[]; limit?: number }) {
  const items = limit ? logs.slice(0, limit) : logs;
  if (!items.length) return <div className="py-6 text-center text-[13px] text-muted">No agent activity yet. Run an analysis to wake the agents.</div>;
  return (
    <div className="grid">
      {items.map((l) => (
        <div key={l.id} className="flex gap-3 py-2.5">
          <Dot color={l.status === "success" ? "#17996A" : l.status === "warn" ? "#D07A1F" : l.agentName.startsWith("Monitoring") ? "#94A3B8" : "#5B8DEF"} />
          <div className="min-w-0">
            <div className="text-[13px] font-medium leading-[1.45] text-ink">
              {l.agentName}: {l.reasoning}
            </div>
            <div className="text-[12px] text-faint">
              {fmtTime(l.createdAt)} · {l.source}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
