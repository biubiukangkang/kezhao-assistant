// 首启隐私同意屏（实施方案 §8.3 / D13 / 任务卡 T11）：由 __root 的同意门渲染，
// 未同意时 <Outlet /> 不挂载，业务页面（首页/课表等）根本不会挂载，其 db 查询自然不发生。
// 全文与设置页「隐私政策」子页（settings.tsx 的 PRIVACY_SECTIONS）同源，
// 不允许改 settings.tsx 抽共享常量，故直接复制，改文案时两处同步。
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isNativeApp } from "@/lib/native";
import { cn } from "@/lib/utils";

/** 摘要：三句话讲完核心承诺 */
const SUMMARY =
  "本应用不联网、不收集任何数据、不接任何统计 SDK；课表和照片只存本机；卸载即清空。";

// 以下全文与 settings.tsx 的 PrivacyPage 保持一致（改文案两处同步）
const FULL_INTRO =
  "课照助手是一款完全离线的课堂拍照归档工具。我们把「不收集」当作功能来设计，而不是口号。";
const FULL_SECTIONS: { h: string; p: string }[] = [
  {
    h: "我们收集什么",
    p: "零收集。没有账号系统，没有统计 SDK，没有广告 SDK，没有崩溃上报。应用不请求网络权限，你的任何数据都不会离开这台手机。",
  },
  {
    h: "数据存在哪",
    p: "课表、课程、照片（含原图）只存本机，使用手机系统的应用存储空间。照片若开启「系统相册同步」，会同时写入系统相册「课照助手」文件夹，同样只在本机。",
  },
  {
    h: "卸载即清空",
    p: "卸载应用时，系统会删除应用内的全部数据。我们没有服务器上的副本可以保留，也无法帮你找回——请定期用「导出备份」留存。",
  },
  {
    h: "首次启动的同意",
    p: "首次启动时会展示本政策并请你确认，同意时间只记在本机；不同意将无法进入主界面。",
  },
  {
    h: "提审托管版本",
    p: "另有一份与本页内容一致的托管版本，供应用商店审核时在线查看（托管地址在提审前填入此处）。",
  },
];

export function PrivacyConsent({ onAgree }: { onAgree: () => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleAgree() {
    setSaving(true);
    setError("");
    try {
      await onAgree();
      // 落库后由 __root 放行 <Outlet />，本组件随即卸载，无需复位 saving
    } catch {
      setError("保存失败，重试一次");
      setSaving(false);
    }
  }

  async function handleExit() {
    try {
      const { App } = await import("@capacitor/app");
      await App.exitApp();
    } catch {
      // 退出失败时留在本屏，用户可用系统返回键/任务栏关闭
    }
  }

  return (
    <div className="mx-auto flex h-dvh max-w-lg flex-col bg-background pt-[max(var(--status-bar-h),env(safe-area-inset-top))]">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-8">
        <h1 className="text-xl font-semibold">隐私政策</h1>
        <p className="pt-3 text-sm leading-relaxed text-muted-foreground">{SUMMARY}</p>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-3 flex min-h-11 items-center gap-1 text-sm font-medium text-primary"
        >
          {expanded ? "收起全文" : "展开全文"}
          <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} />
        </button>

        {expanded && (
          <div className="mt-1 space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">{FULL_INTRO}</p>
            {FULL_SECTIONS.map((s) => (
              <div key={s.h}>
                <h3 className="pb-1 text-[15px] font-semibold">{s.h}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{s.p}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {declined && (
          <p className="pb-3 text-center text-[13px] text-muted-foreground">需要同意后才能使用</p>
        )}
        {error && <p className="pb-3 text-center text-[13px] text-destructive">{error}</p>}
        <Button className="min-h-12 w-full" disabled={saving} onClick={() => void handleAgree()}>
          {saving ? "保存中…" : "同意并继续"}
        </Button>
        <Button
          variant="outline"
          className="mt-3 min-h-12 w-full"
          disabled={saving}
          onClick={() => setDeclined(true)}
        >
          不同意
        </Button>
        {isNativeApp() && (
          <Button
            variant="ghost"
            className="mt-2 min-h-12 w-full text-muted-foreground"
            onClick={() => void handleExit()}
          >
            退出应用
          </Button>
        )}
      </div>
    </div>
  );
}
