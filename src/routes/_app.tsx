import { Outlet, createFileRoute } from "@tanstack/react-router";
import { BottomNav } from "@/components/bottom-nav";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

/** Tab 页共用布局：底部导航（全屏页如导入/查看器放 _app 外） */
function AppLayout() {
  return (
    <div className="mx-auto min-h-screen max-w-lg bg-background pb-20">
      <Outlet />
      <BottomNav />
    </div>
  );
}
