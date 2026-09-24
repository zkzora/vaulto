export function fmtUsd(value: number, opts: { compact?: boolean; decimals?: number } = {}) {
  if (!Number.isFinite(value)) return "—";
  if (opts.compact) {
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
    if (abs >= 10_000) return `$${(value / 1_000).toFixed(1)}K`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: opts.decimals ?? 0,
    minimumFractionDigits: opts.decimals ?? 0,
  }).format(value);
}

export function fmtSigned(value: number, unit = "") {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${unit}${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function fmtPct(value: number, decimals = 1) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(decimals)}%`;
}

export function fmtAmount(value: number, symbol: string) {
  const decimals = symbol === "BTC" ? 2 : symbol === "ETH" || symbol === "BNB" || (value !== 0 && Math.abs(value) < 1) ? 4 : 0;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: symbol === "BTC" ? 1 : 0 })} ${symbol}`;
}

export function shortAddress(address?: string | null, chars = 4) {
  if (!address) return "";
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

export function timeAgo(iso: string, now = Date.now()) {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const s = Math.round(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

export function fmtShortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function round(n: number, decimals = 0) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** Vault display name with the IXS prefix, without doubling it for names that already start with "IX…". */
export function vaultLabel(name: string): string {
  return name.startsWith("IX") ? name : `IXS ${name}`;
}
