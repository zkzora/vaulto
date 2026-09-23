"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRisk, useTreasury } from "@/hooks/use-vaulto";
import { timeAgo } from "@/lib/format";
import { Icons, cx } from "@/components/ui";

const NAV = [
  { href: "/app", label: "Home", icon: Icons.home },
  { href: "/app/strategy", label: "Strategy", icon: Icons.spark },
  { href: "/app/portfolio", label: "Portfolio", icon: Icons.pie },
  { href: "/app/vaults", label: "IXS Strategies", icon: Icons.vault },
  { href: "/app/faucet", label: "Faucet", icon: Icons.drop },
  { href: "/app/risk", label: "Risk Center", icon: Icons.shield },
  { href: "/app/activity", label: "Activity", icon: Icons.list },
  { href: "/app/settings", label: "Settings", icon: Icons.settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data } = useTreasury();
  const risk = useRisk();
  const strategyBadge = data?.recommendation?.status === "proposed" ? 1 : 0;
  const riskBadge = risk.data?.report.alerts.length ?? 0;
  const scannedAt = data?.snapshot.scannedAt;

  return (
    <aside className="hidden min-h-[calc(100vh-64px)] w-[232px] flex-col gap-1 border-r border-line bg-white px-4 py-5 text-[14px] font-medium text-muted lg:flex">
      {NAV.map((item) => {
        const active = item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
        const badge = item.label === "Strategy" ? strategyBadge : item.label === "Risk Center" ? riskBadge : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cx("flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 transition-colors", active ? "bg-tint font-semibold text-blue-deep" : "hover:bg-canvas hover:text-ink")}
          >
            {item.icon}
            {item.label}
            {badge > 0 && (
              <span
                className={cx("ml-auto h-5 min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5 text-white", item.label === "Strategy" ? "bg-blue" : "bg-amber")}
              >
                {badge}
              </span>
            )}
          </Link>
        );
      })}
      <div className="mt-auto rounded-xl bg-canvas p-3.5">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-ink">
          <span className="pulse-dot h-2 w-2 rounded-full bg-green" />
          Agents active
        </div>
        <div className="mt-1 text-[12px] leading-relaxed text-muted">OpenServ · 6 agents · {scannedAt ? `last scan ${timeAgo(scannedAt)}` : "scanning…"}</div>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="sticky bottom-0 z-30 flex justify-around border-t border-line bg-white px-2 py-1.5 lg:hidden">
      {NAV.slice(0, 5).map((item) => {
        const active = item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} className={cx("flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[10px] font-semibold", active ? "text-blue-deep" : "text-muted")}>
            {item.icon}
            {item.label.replace("IXS ", "")}
          </Link>
        );
      })}
    </nav>
  );
}
