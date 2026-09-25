"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useVaultoAccount } from "@/hooks/use-account";
import { Topbar } from "@/components/shell/topbar";
import { MobileNav, Sidebar } from "@/components/shell/sidebar";
import { ReplayBanner } from "@/components/dashboard/replay-toggle";

export default function AppLayout({ children }: { children: ReactNode }) {
  const { address, ready } = useVaultoAccount();
  const router = useRouter();

  useEffect(() => {
    if (ready && !address) router.replace("/connect");
  }, [ready, address, router]);

  if (!ready || !address) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="spinner spinner-blue" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <Topbar />
      <ReplayBanner />
      <div className="flex">
        <Sidebar />
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
          <div className="mx-auto max-w-[1280px]">{children}</div>
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
