import type { ReactNode } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { Toaster } from "@/components/ui/sonner";

/**
 * Tab 页共用外壳：内容容器 + 底部导航 + 全局 toast（全屏页不用此壳）。
 * 滚动发生在内部容器而非 body：应用可能被平台以 iframe 嵌入（iframe 高度自适应时
 * body 滚不出来，鼠标滚轮失效），内部滚动容器不依赖宿主滚动行为。
 */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex h-dvh max-w-lg flex-col bg-background pt-[env(safe-area-inset-top)]">
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <BottomNav />
      <Toaster />
    </div>
  );
}
