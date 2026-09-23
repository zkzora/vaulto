"use client";

import { Icons } from "@/components/ui";

export interface ToastData {
  title: string;
  body: string;
  tone?: "success" | "info";
}

export function Toast({ data, onClose }: { data: ToastData; onClose: () => void }) {
  return (
    <div className="rise fixed bottom-7 left-1/2 z-[70] flex w-[min(92vw,640px)] -translate-x-1/2 items-center gap-3.5 rounded-[14px] bg-navy py-3.5 pl-3.5 pr-4 text-white shadow-modal">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white ${data.tone === "info" ? "bg-blue" : "bg-green"}`}>{data.tone === "info" ? Icons.x : Icons.check}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold">{data.title}</div>
        <div className="truncate text-[12px] text-cloud">{data.body}</div>
      </div>
      <button onClick={onClose} className="ml-2 text-[13px] font-semibold text-sky hover:text-white">
        Dismiss
      </button>
    </div>
  );
}
