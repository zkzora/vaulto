import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function VaultoLogo({ height = 22, className }: { height?: number; className?: string }) {
  return <Image src="/brand/vaulto-logo.png" alt="Vaulto" width={Math.round(height * 4.15)} height={height} priority className={className} style={{ height, width: "auto" }} />;
}

export function OpenServBadge({ size = "sm" }: { size?: "sm" | "md" }) {
  const h = size === "sm" ? 11 : 14;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-navy px-2 text-white" style={{ height: size === "sm" ? 20 : 26 }} title="Reasoning by OpenServ">
      <Image src="/brand/openserv-wordmark-light.png" alt="OpenServ" width={Math.round(h * 4.3)} height={h} style={{ height: h, width: "auto" }} />
    </span>
  );
}

export function IxsMark({ size = 20 }: { size?: number }) {
  return <Image src="/brand/ixs-mark.png" alt="IXS" width={size} height={size} style={{ width: size, height: size, borderRadius: Math.round(size / 4) }} />;
}

export function Pill({ tone = "blue", children, className }: { tone?: "blue" | "green" | "amber" | "muted" | "navy" | "red"; children: ReactNode; className?: string }) {
  const tones: Record<string, string> = {
    blue: "bg-tint text-blue-deep",
    green: "bg-green-tint text-green",
    amber: "bg-amber-tint text-amber",
    muted: "bg-canvas text-muted",
    navy: "bg-navy text-white",
    red: "bg-[#fdecec] text-red",
  };
  return <span className={cx("pill", tones[tone], className)}>{children}</span>;
}

export function Card({ children, className, accent, style }: { children: ReactNode; className?: string; accent?: boolean; style?: CSSProperties }) {
  return (
    <div className={cx(accent ? "card-accent" : "card", "p-6", className)} style={style}>
      {children}
    </div>
  );
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="font-display text-[16px] font-semibold text-ink">{children}</div>
      {action}
    </div>
  );
}

export function Stat({ label, value, sub, tone = "default", className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "default" | "green" | "amber" | "blue"; className?: string }) {
  const color = tone === "green" ? "text-green" : tone === "amber" ? "text-amber" : tone === "blue" ? "text-blue-deep" : "text-ink";
  const bg = tone === "green" ? "bg-green-tint" : tone === "amber" ? "bg-amber-tint" : tone === "blue" ? "bg-tint" : "bg-canvas";
  const labelColor = tone === "default" ? "text-muted" : color;
  const subColor = tone === "default" ? "text-faint" : color;
  return (
    <div className={cx("rounded-xl p-3.5", bg, className)}>
      <div className={cx("text-[12px] font-medium", labelColor)}>{label}</div>
      <div className={cx("mt-1.5 font-display text-[22px] font-semibold leading-none", color)}>{value}</div>
      {sub != null && <div className={cx("mt-1 text-[11px]", subColor)}>{sub}</div>}
    </div>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cx("skeleton", className)} style={style} />;
}

export function Donut({ segments, size = 132, thickness = 18, center }: { segments: { pct: number; color: string }[]; size?: number; thickness?: number; center?: ReactNode }) {
  const { stops, total } = segments
    .filter((s) => s.pct > 0)
    .reduce(
      (acc, s) => ({ stops: [...acc.stops, `${s.color} ${acc.total}% ${acc.total + s.pct}%`], total: acc.total + s.pct }),
      { stops: [] as string[], total: 0 },
    );
  if (total < 100) stops.push(`#EEF1F6 ${total}% 100%`);
  return (
    <div className="relative shrink-0 rounded-full" style={{ width: size, height: size, background: `conic-gradient(${stops.join(",")})` }}>
      <div className="absolute flex flex-col items-center justify-center rounded-full bg-white" style={{ inset: thickness }}>
        {center}
      </div>
    </div>
  );
}

export function BeforeAfterBar({ label, before, after, max = 100 }: { label: string; before: number; after: number; max?: number }) {
  const b = Math.min(100, (before / max) * 100);
  const a = Math.min(100, (after / max) * 100);
  const grew = after >= before;
  return (
    <div>
      <div className="flex justify-between text-[13px] font-medium text-body">
        <span>{label}</span>
        <span className="text-ink">
          <b>{before}%</b> → <b className="text-blue-deep">{after}%</b>
        </span>
      </div>
      <div className="relative mt-1.5 h-2.5 rounded-full bg-line-2">
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(a, b)}%`, background: grew ? "#5B8DEF" : "#CBD5E1" }} />
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(a, b)}%`, background: grew ? "#3F73DA" : "#5B8DEF" }} />
      </div>
    </div>
  );
}

export function TargetBar({ label, actual, target, color }: { label: string; actual: number; target: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-[13px] font-medium text-body">
        <span>{label}</span>
        <span className="text-ink">
          <b>{actual}%</b> <span className="text-faint">/ {target}</span>
        </span>
      </div>
      <div className="relative mt-1.5 h-2 rounded-full bg-line-2">
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, actual)}%`, background: color }} />
        <span className="absolute -top-[3px] h-3.5 w-0.5 bg-ink" style={{ left: `${Math.min(100, target)}%` }} />
      </div>
    </div>
  );
}

export function Dot({ color = "#5B8DEF" }: { color?: string }) {
  return <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-tint">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3F73DA" strokeWidth="1.8" strokeLinejoin="round">
          <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
        </svg>
      </div>
      <div className="mt-4 font-display text-[18px] font-semibold text-ink">{title}</div>
      <div className="mt-1.5 max-w-md text-[14px] leading-relaxed text-body">{body}</div>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="card flex items-center justify-between gap-4 border-amber-line px-5 py-4">
      <div className="text-[14px] text-body">
        <b className="text-ink">Something went wrong.</b> {message}
      </div>
      {retry && (
        <button className="btn btn-soft" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  );
}

export const Icons = {
  home: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" />
    </svg>
  ),
  spark: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
    </svg>
  ),
  pie: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v9h9" />
    </svg>
  ),
  vault: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  ),
  shield: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
    </svg>
  ),
  list: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  ),
  settings: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </svg>
  ),
  check: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5L20 7" />
    </svg>
  ),
  x: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  arrow: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5B8DEF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
  warn: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3F73DA" strokeWidth="2" strokeLinecap="round">
      <path d="M12 3l10 18H2zM12 10v4M12 18v.5" />
    </svg>
  ),
  info: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3F73DA" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16v.5" />
    </svg>
  ),
  bell: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B4A63" strokeWidth="1.8" strokeLinecap="round">
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20h4" />
    </svg>
  ),
  drop: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
    </svg>
  ),
  external: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </svg>
  ),
};
