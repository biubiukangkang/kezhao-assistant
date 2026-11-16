// AI 转课表向导（实施方案 §7.1）：1 复制提示词 → 2 去 AI 转换 → 3 粘贴结果，任意步可退。
// 第 1 步提示词按用户 periods/defaultWeeks 动态生成；第 3 步实时解析（KZS1 四通道，500ms 防抖）
// → 三态 ok/warn/fail 呈现 → TimetablePreview 预览 → applyTimetable 落库。
import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleX,
  ClipboardPaste,
  Copy,
  RotateCcw,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import { TimetablePreview } from "@/components/timetable-preview";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { getSettings } from "@/lib/db";
import { generateImportPrompt } from "@/lib/import-prompt";
import { weeksLabel } from "@/lib/match";
import { isNativeApp } from "@/lib/native";
import { periodLabel } from "@/lib/periods";
import { parseKzs, type KzsParseResult } from "@/lib/timetable-format";
import { applyTimetable, kzsToParseResult } from "@/lib/timetable-parse";
import { WEEKDAY_NAMES, type AppSettings } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/import-ai")({
  component: ImportAiPage,
});

const STEP_NAMES: Record<1 | 2 | 3, string> = { 1: "复制提示词", 2: "去 AI 转换", 3: "粘贴结果" };

/** 第 2 步折叠区调教话术：AI 输出不合要求时，复制发给它 */
const COACH_PHRASES: { label: string; text: string }[] = [
  {
    label: "只输出表格行",
    text: "只输出「课程名 | 星期 | 节次 | 周次 | 教师 | 教室」的表格行，不要任何解释文字。",
  },
  {
    label: "太长分批问",
    text: "课表太长了，我们分批来：先输出周一到周三的课，之后我会说“继续”。",
  },
  {
    label: "格式不标准尽管粘",
    text: "如果某行信息不全，就按你有的信息输出，格式乱一点也没关系，我会手工改。",
  },
];

/** §7.1 固定隐私提示文案 */
const PRIVACY_NOTE =
  "提示词只是文字，本应用不会联网。你把课表图片发给 AI 应用时，图片会经过那个应用的服务器，请自行确认是否接受；不接受可以走手动录入。";

/** 剪贴板三档兜底：async clipboard → execCommand；都失败返回 false，由 UI 引导手动复制 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 权限被拒 / 非安全上下文，走 execCommand 兜底
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** 大节区间展示：单个「第1-2节」，跨大节「第3-6节」 */
function periodText(p0: number, p1: number): string {
  return p0 === p1 ? `第${periodLabel(p0)}节` : `第${p0 * 2 + 1}-${p1 * 2 + 2}节`;
}

function ImportAiPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [promptOpen, setPromptOpen] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);

  // 第 3 步状态（切步不丢：支持分批粘贴合并）
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<KzsParseResult | null>(null);
  const [droppedFailed, setDroppedFailed] = useState<number[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    void getSettings().then(setSettings);
  }, []);

  const prompt = useMemo(
    () =>
      settings && settings.periods.length > 0
        ? generateImportPrompt({ periods: settings.periods, defaultWeeks: settings.defaultWeeks })
        : "",
    [settings],
  );

  // 实时解析：停止输入 500ms 后跑 KZS1 四通道（解析 <100ms，防抖只为少跑）
  useEffect(() => {
    if (!settings) return;
    const timer = setTimeout(() => {
      if (!text.trim()) {
        setParsed(null);
        return;
      }
      setParsed(
        parseKzs(text, { periods: settings.periods, defaultWeeks: settings.defaultWeeks }),
      );
    }, 500);
    return () => clearTimeout(timer);
  }, [text, settings]);

  const handleCopyPrompt = useCallback(async () => {
    if (!prompt) {
      toast("提示词还没生成");
      return;
    }
    if (await copyText(prompt)) {
      setManualCopy(false);
      setStep(2); // 复制成功即进入第 2 步（去 AI 转换的操作指引）
      toast.success("提示词已复制，去粘贴给 AI 吧");
    } else {
      setManualCopy(true);
    }
  }, [prompt]);

  const handleCopyPhrase = useCallback(async (t: string) => {
    if (await copyText(t)) toast.success("已复制，去发给 AI 吧");
    else toast.error("复制失败，请长按选中文字手动复制");
  }, []);

  const handleShare = useCallback(async () => {
    try {
      if (isNativeApp()) {
        const { Share } = await import("@capacitor/share");
        await Share.share({ title: "AI 转课表提示词", text: prompt, dialogTitle: "分享给 AI 应用" });
        return;
      }
      if (typeof navigator.share === "function") {
        await navigator.share({ title: "AI 转课表提示词", text: prompt });
        return;
      }
      toast("当前环境不支持分享，请用「复制提示词」");
    } catch {
      // 用户在分享面板取消，不打扰
    }
  }, [prompt]);

  const handlePaste = useCallback(async () => {
    try {
      if (!navigator.clipboard?.readText) {
        toast("当前环境不支持读取剪贴板，请长按输入框粘贴");
        return;
      }
      const t = await navigator.clipboard.readText();
      if (t.trim()) {
        setText(t);
        toast.success("已粘贴");
      } else {
        toast("剪贴板是空的");
      }
    } catch {
      toast("浏览器不让直接读剪贴板，请长按输入框粘贴");
    }
  }, []);

  // KzsRow（p0/p1 大节下标）→ ParseResult：warn 并入 ok 一并导入，failed 转「第N行：原文」
  const parseResult = useMemo(
    () => (parsed ? kzsToParseResult(parsed) : { ok: [], failed: [] }),
    [parsed],
  );

  const slotCount = parsed ? parsed.ok.length + parsed.warn.length : 0;
  const courseCount = parsed
    ? new Set([...parsed.ok, ...parsed.warn].map((r) => r.name)).size
    : 0;

  const handleImport = useCallback(async () => {
    if (!settings) return;
    setImporting(true);
    try {
      const n = await applyTimetable(parseResult.ok, settings.periods);
      toast.success(`已导入 ${n} 节课`);
      void navigate({ to: "/schedule" });
    } catch {
      toast.error("导入失败，请重试");
      setImporting(false);
    }
  }, [parseResult.ok, settings, navigate]);

  const goBack = useCallback(() => {
    if (showPreview) setShowPreview(false);
    else if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
    else router.history.back();
  }, [step, showPreview, router]);

  return (
    <div className="mx-auto flex h-dvh max-w-lg flex-col bg-background">
      <header className="z-30 flex shrink-0 items-center gap-1 border-b bg-background/95 px-2 py-2.5 pt-[max(0.75rem,var(--status-bar-h),env(safe-area-inset-top))] backdrop-blur">
        <button
          type="button"
          aria-label="返回"
          onClick={goBack}
          className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted active:bg-muted"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight">AI 转课表</h1>
          <p className="text-xs text-muted-foreground">
            {showPreview
              ? "预览导入"
              : `第 ${step} 步 / 共 3 步 · ${STEP_NAMES[step]}`}
          </p>
        </div>
        <div className="flex gap-1 pr-2">
          {([1, 2, 3] as const).map((s) => (
            <span
              key={s}
              className={cn("h-1.5 w-6 rounded-full", s <= step ? "bg-primary" : "bg-muted")}
            />
          ))}
        </div>
      </header>

      {/* 入口下固定一行：不用 AI 的退路 */}
      <button
        type="button"
        onClick={() => void navigate({ to: "/settings" })}
        className="flex shrink-0 items-center justify-center gap-0.5 py-1.5 text-xs text-muted-foreground transition-colors active:text-foreground"
      >
        不用 AI？手动录入同样好用
        <ChevronRight className="size-3.5" />
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {!settings ? (
          <p className="pt-16 text-center text-sm text-muted-foreground">加载中…</p>
        ) : showPreview ? (
          <TimetablePreview
            parsed={parseResult}
            droppedFailed={droppedFailed}
            onDropFailed={(i) => setDroppedFailed((d) => [...d, i])}
            onBack={() => setShowPreview(false)}
            importing={importing}
            onImport={() => void handleImport()}
          />
        ) : step === 1 ? (
          <section className="space-y-3">
            <p className="text-sm leading-6 text-muted-foreground">
              把下面这段提示词复制给任意 AI（豆包、Kimi、DeepSeek 等），再把你的课表截图或文件发给它，它就会整理成能直接粘回来的课表行。
            </p>
            <div className="rounded-lg border bg-muted/30">
              <div className="relative">
                <pre
                  className={cn(
                    "whitespace-pre-wrap px-3 py-2 text-xs leading-5",
                    !promptOpen && "max-h-32 overflow-hidden",
                  )}
                >
                  {prompt}
                </pre>
                {!promptOpen && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-muted/30 to-transparent" />
                )}
              </div>
              <button
                type="button"
                onClick={() => setPromptOpen(!promptOpen)}
                className="flex w-full items-center justify-center gap-1 border-t py-1.5 text-xs text-muted-foreground transition-colors active:text-foreground"
              >
                {promptOpen ? "收起" : "展开全文"}
                <ChevronDown className={cn("size-3.5 transition-transform", promptOpen && "rotate-180")} />
              </button>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => void handleCopyPrompt()}>
                <Copy />
                复制提示词
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => void handleShare()}>
                <Share2 />
                分享给 AI 应用
              </Button>
            </div>
            {manualCopy && (
              <div className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                <p className="font-medium text-amber-600 dark:text-amber-400">
                  自动复制没成功，请长按下面全选复制：
                </p>
                <pre className="max-h-40 select-all overflow-auto whitespace-pre-wrap rounded bg-background/60 p-2 text-[11px] leading-5">
                  {prompt}
                </pre>
              </div>
            )}
            <p className="rounded-lg border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
              {PRIVACY_NOTE}
            </p>
            <button
              type="button"
              onClick={() => void navigate({ to: "/settings" })}
              className="flex w-full items-center justify-center gap-0.5 py-1 text-xs text-muted-foreground transition-colors active:text-foreground"
            >
              作息不对？去改节次时间
              <ChevronRight className="size-3.5" />
            </button>
          </section>
        ) : step === 2 ? (
          <section className="space-y-3">
            <ol className="space-y-2">
              {[
                "打开任意 AI 应用（豆包、Kimi、DeepSeek、ChatGPT 都可以）",
                "把提示词发给它",
                "再把课表截图、Excel 或文字描述发给它",
                "等它输出「课程名 | 星期 | 节次 | 周次 | 教师 | 教室」的表格行",
                "长按输出全选复制，回到本页粘贴",
              ].map((t, i) => (
                <li
                  key={i}
                  className="flex gap-2.5 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground">
                    {i + 1}
                  </span>
                  <span className="leading-5">{t}</span>
                </li>
              ))}
            </ol>
            <div className="flex gap-2 pt-1">
              <Button className="flex-1" onClick={() => setStep(3)}>
                <Check />
                已复制，去下一步
              </Button>
              <Button variant="outline" onClick={() => void handleCopyPrompt()}>
                <RotateCcw />
                再复制一次
              </Button>
            </div>
            <details className="rounded-lg border bg-muted/30 px-3 py-2">
              <summary className="cursor-pointer py-1 text-sm font-medium">
                AI 不听话？把这些话说给它听
              </summary>
              <div className="space-y-2 pt-2">
                {COACH_PHRASES.map((p) => (
                  <div
                    key={p.label}
                    className="flex items-start gap-2 rounded-md border bg-background/60 p-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium">{p.label}</p>
                      <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{p.text}</p>
                    </div>
                    <button
                      type="button"
                      aria-label={`复制「${p.label}」`}
                      onClick={() => void handleCopyPhrase(p.text)}
                      className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors active:bg-muted"
                    >
                      <Copy className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </details>
          </section>
        ) : (
          <section className="space-y-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder={"把 AI 的输出粘贴到这里，例如：\n高等数学 | 周一 | 1-2节 | 1-16周 | 张三 | 50302"}
              className="w-full resize-none rounded-lg border bg-background p-3 text-sm leading-6 transition-colors placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void handlePaste()}>
                <ClipboardPaste />
                从剪贴板粘贴
              </Button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              粘贴不上？长按上面输入框选「粘贴」。可以分多次粘贴，内容会合并，重复行自动去重。
            </p>

            {parsed && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  识别到 {courseCount} 门课 · {slotCount} 个时段
                  {parsed.failed.length > 0 && (
                    <span className="text-destructive"> · {parsed.failed.length} 行没识别</span>
                  )}
                </p>
                {parsed.ok.length > 0 && (
                  <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border bg-muted/20 p-2">
                    {parsed.ok.slice(0, 100).map((r, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <CircleCheck className="size-3.5 shrink-0 text-green-600 dark:text-green-400" />
                        <span className="min-w-0 truncate font-medium">{r.name}</span>
                        <span className="ml-auto shrink-0 text-muted-foreground">
                          {WEEKDAY_NAMES[r.weekday - 1]} {periodText(r.p0, r.p1)} {weeksLabel(r.weeks)}
                        </span>
                      </div>
                    ))}
                    {parsed.ok.length > 100 && (
                      <p className="px-1 text-xs text-muted-foreground">…等共 {parsed.ok.length} 行</p>
                    )}
                  </div>
                )}
                {parsed.warn.map((r, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-2.5 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <CircleAlert className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span className="min-w-0 truncate font-medium">{r.name}</span>
                      <span className="ml-auto shrink-0 text-muted-foreground">
                        {WEEKDAY_NAMES[r.weekday - 1]} {periodText(r.p0, r.p1)}{" "}
                        {weeksLabel(r.weeks)}
                      </span>
                    </div>
                    <p className="mt-1 leading-5 text-amber-700 dark:text-amber-300">{r.issue}</p>
                  </div>
                ))}
                {parsed.failed.map((f, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-destructive/40 bg-destructive/5 px-2.5 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <CircleX className="size-3.5 shrink-0 text-destructive/70" />
                      <span className="font-medium">第 {f.lineNo} 行</span>
                    </div>
                    <p className="mt-1 break-all leading-5 text-muted-foreground">{f.raw}</p>
                    <p className="mt-0.5 leading-5 text-destructive/80">{f.reason}</p>
                    {f.suggestion && (
                      <p className="mt-0.5 leading-5 text-muted-foreground">{f.suggestion}</p>
                    )}
                  </div>
                ))}
                {slotCount === 0 && (
                  <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs leading-5 text-destructive">
                    没识别出课程。确认复制的是 AI 输出的表格行；格式不标准也可以直接粘，解析器会尽量认。
                  </p>
                )}
              </div>
            )}

            <Button className="w-full" disabled={slotCount === 0} onClick={() => setShowPreview(true)}>
              预览导入
            </Button>
          </section>
        )}
      </div>
      <Toaster duration={2800} />
    </div>
  );
}
