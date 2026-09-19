import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clearAllData, getSettings, saveSettings } from "@/lib/db";
import { MAX_SEMESTER_WEEKS, getSemesterWeek } from "@/lib/match";
import { hhmmToMin, minToHHmm, periodLabel } from "@/lib/periods";
import { seedDemoData } from "@/lib/seed";
import type { AppSettings } from "@/lib/types";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

/** 折叠卡片：收起时只露一行摘要，点开才显示配置项 */
function FoldCard({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex min-h-7 w-full items-center justify-between gap-2 rounded-lg text-left active:bg-muted"
      >
        <span>
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">{summary}</span>
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="mt-3 space-y-4 border-t pt-3">{children}</div>}
    </section>
  );
}

function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    void getSettings().then(setSettings);
  }, []);

  if (!settings) return null;

  const persist = (next: AppSettings) => {
    setSettings(next);
    void saveSettings(next);
  };
  const week = getSemesterWeek(Date.now(), settings.semesterStart);

  function updatePeriod(i: number, which: "start" | "end", text: string) {
    const min = hhmmToMin(text);
    if (min === null) return;
    const periods = settings!.periods.map((p, idx) => {
      if (idx !== i) return p;
      return which === "start" ? { ...p, startMin: min } : { ...p, endMin: min };
    });
    if (periods[i].startMin >= periods[i].endMin) return; // 开始必须早于结束
    persist({ ...settings!, periods });
  }

  async function handleSeed() {
    setSeeding(true);
    try {
      const r = await seedDemoData();
      toast.success(`已填充 ${r.courses} 门课 · ${r.photos} 张照片`, {
        description: "回首页和课程库看看效果",
      });
      void getSettings().then(setSettings);
    } finally {
      setSeeding(false);
    }
  }

  async function handleClear() {
    await clearAllData();
    void getSettings().then(setSettings);
  }

  return (
    <div className="space-y-4 px-4 pt-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">设置</h1>
      </header>

      <FoldCard
        title="课表"
        summary={
          week !== null
            ? `学期第 ${week} 周 · 每天 ${settings.periods.length} 大节`
            : "未设置学期起始日"
        }
      >
        <Link
          to="/schedule"
          className="-mx-1 flex min-h-10 items-center justify-between rounded-lg px-1 active:bg-muted"
        >
          <span className="text-sm font-medium">管理课表</span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
        <div>
          <h3 className="text-xs font-medium text-muted-foreground">学期起始</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            填第 1 周周一的日期，照片归档靠它算周次。
          </p>
          <Input
            type="date"
            value={settings.semesterStart}
            onChange={(e) => persist({ ...settings, semesterStart: e.target.value })}
            className="mt-2 min-h-11"
          />
          {settings.semesterStart && (
            <p className="mt-1.5 text-xs">
              {week !== null ? (
                <span className="font-medium text-green-600">现在是第 {week} 周 ✓</span>
              ) : (
                <span className="text-destructive">
                  当前日期不在学期范围内（1-{MAX_SEMESTER_WEEKS} 周），请检查日期
                </span>
              )}
            </p>
          )}
        </div>

        <div>
          <h3 className="text-xs font-medium text-muted-foreground">节次时间</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            按学校作息改，改完自动保存（开始要早于结束）。
          </p>
          <div className="mt-2 space-y-2">
            {settings.periods.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-xs font-medium">{periodLabel(i)} 节</span>
                <Input
                  type="time"
                  value={minToHHmm(p.startMin)}
                  onChange={(e) => updatePeriod(i, "start", e.target.value)}
                  className="min-h-10"
                  aria-label={`第 ${periodLabel(i)} 节开始时间`}
                />
                <span className="text-xs text-muted-foreground">–</span>
                <Input
                  type="time"
                  value={minToHHmm(p.endMin)}
                  onChange={(e) => updatePeriod(i, "end", e.target.value)}
                  className="min-h-10"
                  aria-label={`第 ${periodLabel(i)} 节结束时间`}
                />
              </div>
            ))}
          </div>
        </div>
      </FoldCard>

      <FoldCard title="数据" summary="填充演示数据，或清空全部">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="min-h-11 w-full" disabled={seeding}>
              {seeding ? "填充中…" : "填充演示数据"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>填充演示数据？</AlertDialogTitle>
              <AlertDialogDescription>
                会用 4 门示例课和 11 张示例照片覆盖当前的全部数据。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>先不填</AlertDialogCancel>
              <AlertDialogAction onClick={handleSeed}>填充</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              className="min-h-11 w-full text-destructive hover:text-destructive"
            >
              清空全部数据
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>清空全部数据？</AlertDialogTitle>
              <AlertDialogDescription>
                课表、课程和所有照片都会删除，无法恢复。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>先不清</AlertDialogCancel>
              <AlertDialogAction onClick={handleClear}>全部清空</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <p className="text-center text-xs text-muted-foreground">
          所有数据只保存在本机浏览器里，不会上传。
        </p>
      </FoldCard>

      <p className="pb-2 text-center text-xs text-muted-foreground">课照助手 · v0.1</p>
    </div>
  );
}
