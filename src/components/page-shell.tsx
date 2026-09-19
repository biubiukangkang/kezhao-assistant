import type { ReactNode } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { Toaster } from "@/components/ui/sonner";

/** Tab 页共用外壳：内容容器 + 底部导航 + 全局 toast（全屏页不用此壳） */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto min-h-screen max-w-lg bg-background pb-20">
      {children}
      <BottomNav />
      <Toaster />
    </div>
  );
}
