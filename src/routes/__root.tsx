import { useEffect, useState } from "react";
import { Link, Outlet, createRootRoute } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { PrivacyConsent } from "@/components/privacy-consent";
import { DEFAULT_SETTINGS, getSettings, saveSettings } from "@/lib/db";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-foreground">页面未找到</h1>
        <p className="mt-2 text-sm text-muted-foreground">你访问的页面不存在，或已被移动。</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">页面加载失败</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          页面暂时无法加载。你可以尝试重试，或返回首页。
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            重试
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            返回首页
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  component: RootRoute,
  errorComponent: ErrorComponent,
  notFoundComponent: NotFoundComponent,
});

/**
 * 首启隐私同意门（实施方案 §8.3 / D13 / 任务卡 T11）：
 * reading → 读 settings（meta 单键，非业务数据）期间只显示极简 loading，避免主界面闪一下；
 * gate    → privacyAgreedAt 缺失：只渲染同意屏，<Outlet /> 不挂载，业务页面（首页/课表等）
 *           的 db 查询自然不发生，满足「同意前不读写业务数据」；
 * main    → 已同意（或本次刚同意并落库）：放行 <Outlet />。
 * T10「清空所有数据」会把 settings 重置为 DEFAULT_SETTINGS（不含 privacyAgreedAt），
 * 清数据重启即回到 gate，实现验收「清数据重启再弹」。
 */
type Gate = "reading" | "gate" | "main";

function RootRoute() {
  const [gate, setGate] = useState<Gate>("reading");

  useEffect(() => {
    void (async () => {
      // 读失败（IndexedDB 不可用）从严：当未同意处理，不放进主界面
      const s = await getSettings().catch(() => null);
      setGate(s?.privacyAgreedAt ? "main" : "gate");
    })();
  }, []);

  /** 同意并继续：读最新 settings 再写 privacyAgreedAt（不清用户已有设置），落库后放行 */
  async function agree() {
    const fresh = await getSettings().catch(() => null);
    await saveSettings({ ...(fresh ?? DEFAULT_SETTINGS), privacyAgreedAt: Date.now() });
    setGate("main");
  }

  if (gate === "reading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoaderCircle
          className="size-6 animate-spin text-muted-foreground"
          role="status"
          aria-label="正在打开"
        />
      </div>
    );
  }
  if (gate === "gate") return <PrivacyConsent onAgree={agree} />;
  return <Outlet />;
}
