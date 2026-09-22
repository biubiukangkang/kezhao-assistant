import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/page-shell";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { toast } from "sonner";
import {
  applyTimetable,
  parseTimetableText,
  type ParseResult,
} from "@/lib/timetable-parse";
import { aiParseTimetable } from "@/lib/timetable-ai";
import { parseTimetableWorkbook } from "@/lib/timetable-xls";
import { TimetablePreview } from "@/components/timetable-preview";
import { UpdateDialog } from "@/components/update-dialog";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  clearAllData,
  deletePhoto,
  getSettings,
  listCourses,
  listDeletedPhotos,
  listPhotos,
  purgeExpiredPhotos,
  restorePhoto,
  saveSettings,
  TRASH_DAYS,
} from "@/lib/db";
import { MAX_SEMESTER_WEEKS, getSemesterWeek, weekdayOf } from "@/lib/match";
import { hhmmToMin, minToHHmm, periodLabel } from "@/lib/periods";
import {
  backupChunks,
  backupFilename,
  exportBackup,
  importBackup,
  inspectBackup,
  markBackupDone,
  type BackupPreview,
} from "@/lib/backup";
import {
  folderState,
  folderSupported,
  pickFolder,
  regrantFolder,
  stopFolderSync,
  syncAllPhotos,
} from "@/lib/photo-folder";
import {
  isNativeApp,
  openGalleryFolder,
  migrateAlbumStructure,
  albumStructureUpToDate,
  shareBackupFile,
} from "@/lib/native";
import { checkUpdate, currentVersion, type UpdateInfo } from "@/lib/updater";
import { type AppSettings, type Photo } from "@/lib/types";

export const Route = createFileRoute("/settings")({
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
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [droppedFailed, setDroppedFailed] = useState<number[]>([]);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [folder, setFolder] = useState<{
    name: string | null;
    permission: "granted" | "prompt" | "denied" | null;
  } | null>(null);
  const [storage, setStorage] = useState<{ photos: number; trashed: number; usageMB: string } | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [deleted, setDeleted] = useState<Photo[]>([]);
  const [restorePreview, setRestorePreview] = useState<{
    file: File;
    preview: BackupPreview;
    current: { courses: number; photos: number };
  } | null>(null);
  // AI 识别导入（截图选完立即读成 dataURL——picker 临时授权延迟读取会 NotReadableError）
  const [aiOpen, setAiOpen] = useState(false);
  const [aiImageDataUrls, setAiImageDataUrls] = useState<string[]>([]);
  const [aiReading, setAiReading] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const aiFileRef = useRef<HTMLInputElement>(null);
  // 检查更新
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const xlsRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const nativeApp = isNativeApp();
  const folderOk = folderSupported();

  async function loadStorage() {
    const [photos, trashed] = await Promise.all([listPhotos(), listDeletedPhotos()]);
    let usageMB = "";
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.usage) usageMB = (est.usage / 1024 / 1024).toFixed(1);
    } catch {
      /* 部分环境不支持，不显示占用 */
    }
    setStorage({ photos: photos.length, trashed: trashed.length, usageMB });
  }

  async function loadTrash() {
    setDeleted(await listDeletedPhotos());
  }

  async function handleXlsFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const slots = parseTimetableWorkbook(buf);
      if (slots.length === 0) {
        toast.error("没从这个文件里认出课表，确认是教务系统导出的课表文件");
        return;
      }
      setParsed({ ok: slots, failed: [] });
      setDroppedFailed([]);
      setPasteOpen(true);
    } catch {
      toast.error("文件读取失败，换一个试试");
    }
  }

  useEffect(() => {
    void getSettings().then(setSettings);
    if (folderOk) void folderState().then(setFolder);
    void loadStorage();
    if (nativeApp) void currentVersion().then(setAppVersion);
  }, [folderOk, nativeApp]);

  // 旧版相册是平铺布局：升级后首次进入设置页，自动把镜像重排成科目子文件夹（主库重写，幂等）
  useEffect(() => {
    if (!nativeApp) return;
    void (async () => {
      if (await albumStructureUpToDate()) return;
      const r = await migrateAlbumStructure();
      if (r.ok > 0) {
        toast.success(`相册已按科目重新归档 ${r.ok} 张${r.fail > 0 ? `，失败 ${r.fail} 张` : ""}`, {
          description: "系统相册「课照助手」下按课程分文件夹",
        });
        void folderState().then(setFolder);
      }
    })();
  }, [nativeApp]);

  const trashUrls = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of deleted) {
      const src = (p.thumb ?? p.blob) as Blob | undefined;
      if (src) m.set(p.id, URL.createObjectURL(src));
    }
    return m;
  }, [deleted]);
  useEffect(
    () => () => {
      trashUrls.forEach((u) => URL.revokeObjectURL(u));
    },
    [trashUrls],
  );

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

  function addPeriod() {
    const last = settings!.periods[settings!.periods.length - 1];
    const startMin = Math.min(last.endMin + 15, 23 * 60);
    const endMin = Math.min(startMin + 95, 23 * 60 + 59);
    if (startMin >= endMin) {
      toast.error("已经到深夜了，加不下新的一节");
      return;
    }
    persist({ ...settings!, periods: [...settings!.periods, { startMin, endMin }] });
  }

  function removePeriod(i: number) {
    if (settings!.periods.length <= 1) return;
    persist({ ...settings!, periods: settings!.periods.filter((_, idx) => idx !== i) });
  }

  async function handleClear() {
    await clearAllData();
    void getSettings().then(setSettings);
    void loadStorage();
  }

  async function handleOpenFolder() {
    try {
      const via = await openGalleryFolder();
      if (via === "gallery") {
        toast("已打开系统相册", { description: "在相册里找到「课照助手」文件夹即可" });
      }
    } catch {
      toast.error("打不开文件管理器", { description: "可手动前往 文件管理器 → Pictures/课照助手 查看" });
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      if (nativeApp) {
        // 流式逐块写缓存文件再分享，几百张照片内存占用也恒定
        await shareBackupFile(backupChunks, backupFilename());
        await markBackupDone();
        void loadStorage();
        toast.success("备份已生成", { description: "已调起系统分享，可保存到文件或发送" });
      } else {
        const { blob, filename } = await exportBackup();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
        await markBackupDone();
        void loadStorage();
        toast.success("备份已下载", { description: "文件保存在浏览器下载目录" });
      }
    } catch {
      toast.error("导出失败，重试一次");
    } finally {
      setExporting(false);
    }
  }

  async function handleRestorePick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setRestoring(true);
    try {
      const preview = await inspectBackup(file);
      if (!preview.valid) {
        toast.error(preview.error ?? "不是有效的备份文件");
        return;
      }
      const [courses, photos] = await Promise.all([listCourses(), listPhotos()]);
      setRestorePreview({
        file,
        preview,
        current: { courses: courses.length, photos: photos.length },
      });
    } finally {
      setRestoring(false);
    }
  }

  async function confirmRestore() {
    if (!restorePreview) return;
    setRestoring(true);
    try {
      const r = await importBackup(restorePreview.file);
      toast.success(`已恢复 ${r.courses} 门课 · ${r.photos} 张照片`);
      setRestorePreview(null);
      void getSettings().then(setSettings);
      void loadStorage();
    } catch {
      toast.error("恢复失败，确认选择的是本应用导出的备份文件");
    } finally {
      setRestoring(false);
    }
  }

  async function handleRestorePhoto(id: string) {
    await restorePhoto(id);
    await loadTrash();
    await loadStorage();
  }

  async function handlePurgePhoto(id: string) {
    await deletePhoto(id);
    await loadTrash();
    await loadStorage();
  }

  async function handleEmptyTrash() {
    for (const p of deleted) await deletePhoto(p.id);
    await loadTrash();
    await loadStorage();
  }

  async function refreshFolder() {
    setFolder(await folderState());
  }

  async function handlePickFolder() {
    try {
      const name = await pickFolder();
      if (!name) {
        await refreshFolder();
        return;
      }
      toast.success(`照片将存到「${name}」`, { description: "已有照片也正在放进去…" });
      setSyncing(true);
      try {
        const { ok, fail } = await syncAllPhotos();
        if (ok + fail > 0) {
          toast.success(`已放入 ${ok} 张已有照片${fail > 0 ? `，失败 ${fail} 张` : ""}`);
        }
      } catch {
        // 全量同步失败不阻断，可手动再点「把已有照片放进去」
      } finally {
        setSyncing(false);
      }
      await refreshFolder();
    } catch {
      // 用户取消选择
    }
  }

  async function handleRegrant() {
    const ok = await regrantFolder();
    if (!ok) toast.error("授权没有通过，再点一次试试");
    await refreshFolder();
  }

  async function handleStopSync() {
    await stopFolderSync();
    toast(nativeApp ? "已停止自动存入相册" : "已停止文件夹同步");
    await refreshFolder();
  }

  async function handleSyncAll() {
    setSyncing(true);
    try {
      const { ok, fail } = await syncAllPhotos();
      if (ok + fail === 0) toast("没有需要同步的照片");
      else
        toast.success(`已同步 ${ok} 张${fail > 0 ? `，失败 ${fail} 张` : ""}`, {
          description: nativeApp ? "在系统相册「课照助手」里可见" : "打开你选的文件夹就能看到",
        });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "同步失败");
      await refreshFolder();
    } finally {
      setSyncing(false);
    }
  }

  async function onAiFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setAiReading(true);
    try {
      const { imageToDataUrl } = await import("@/lib/timetable-ai");
      const urls: string[] = [];
      for (const f of files) {
        urls.push(await imageToDataUrl(f));
      }
      setAiImageDataUrls(urls);
    } catch {
      toast.error("截图读取失败，重新选一次试试");
    } finally {
      setAiReading(false);
    }
  }

  async function handleAiParse() {
    setAiBusy(true);
    try {
      const rows = await aiParseTimetable(
        { imageDataUrls: aiImageDataUrls, text: aiText },
        settings!.periods,
      );
      setAiOpen(false);
      setDroppedFailed([]);
      setParsed({ ok: rows, failed: [] });
      setPasteOpen(true); // 复用既有预览 → applyTimetable 导入链路
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI 识别失败，再试一次");
    } finally {
      setAiBusy(false);
    }
  }

  async function handleCheckUpdate() {
    setChecking(true);
    try {
      const u = await checkUpdate();
      if (u) setUpdate(u);
      else toast("已是最新版本", { description: `当前 v${appVersion ?? "?"}` });
    } catch {
      toast.error("检查更新失败，看看网络");
    } finally {
      setChecking(false);
    }
  }

  function openPaste() {
    setPasteText("");
    setParsed(null);
    setDroppedFailed([]);
    setPasteOpen(true);
  }

  function doParse() {
    const result = parseTimetableText(pasteText, settings!.periods);
    setParsed(result);
    setDroppedFailed([]);
    if (result.ok.length === 0) {
      toast.error("没解析出任何课程，对照示例检查一下格式");
    }
  }

  async function doImport() {
    if (!parsed) return;
    setImporting(true);
    try {
      const n = await applyTimetable(parsed.ok, settings!.periods);
      toast.success(`已导入 ${parsed.ok.length} 门课 · ${n} 个时段`, {
        description: "改过课表后，可到「待分类」一键重新匹配已有照片",
      });
      setPasteOpen(false);
      void getSettings().then(setSettings);
    } finally {
      setImporting(false);
    }
  }

  return (
    <PageShell>
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
        {nativeApp && (
          <>
            <button
              type="button"
              onClick={() => setAiOpen(true)}
              className="-mx-1 flex min-h-10 w-full items-center justify-between rounded-lg bg-primary/5 px-1 active:bg-muted"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="size-4 text-primary" />
                AI 识别导入（推荐）
              </span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
            <p className="mt-0.5 text-xs text-muted-foreground">
              拍一张教务系统课表截图（或粘贴文字），AI 自动排好课表，格式随便什么样都认得。
            </p>
          </>
        )}
        <Link
          to="/schedule"
          className="-mx-1 flex min-h-10 items-center justify-between rounded-lg px-1 active:bg-muted"
        >
          <span className="text-sm font-medium">管理课表</span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
        <button
          type="button"
          onClick={() => xlsRef.current?.click()}
          className="-mx-1 flex min-h-10 w-full items-center justify-between rounded-lg px-1 active:bg-muted"
        >
          <span className="text-sm font-medium">导入课表文件</span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
        <p className="mt-0.5 text-xs text-muted-foreground">
          直接选教务系统导出的 .xls / .xlsx 课表文件，自动识别全部课程。
        </p>
        <button
          type="button"
          onClick={openPaste}
          className="-mx-1 flex min-h-10 w-full items-center justify-between rounded-lg px-1 active:bg-muted"
        >
          <span className="text-sm font-medium">从课表文本导入</span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
        <p className="mt-0.5 text-xs text-muted-foreground">
          把教务系统复制的课表整段粘进来，自动识别课程和周次。
        </p>
        <div>
          <h3 className="text-xs font-medium text-muted-foreground">学期起始</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            填第 1 周周一的日期（选了别的日子会自动对齐到那周的周一），照片归档靠它算周次。
          </p>
          <Input
            type="date"
            value={settings.semesterStart}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) {
                persist({ ...settings, semesterStart: "" });
                return;
              }
              // 周次锚点必须是周一，靠代码保证而不是靠用户记文案
              const [y, m, d] = v.split("-").map(Number);
              const date = new Date(y, m - 1, d);
              const wd = weekdayOf(date.getTime());
              if (wd !== 1) {
                date.setDate(date.getDate() - (wd - 1));
                const pad = (n: number) => String(n).padStart(2, "0");
                const aligned = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
                persist({ ...settings, semesterStart: aligned });
                toast(`第 1 周从周一起算，已自动对齐到 ${aligned}`);
              } else {
                persist({ ...settings, semesterStart: v });
              }
            }}
            className="mt-2 min-h-11"
          />
          {settings.semesterStart && (
            <p className="mt-1.5 text-xs">
              {week !== null ? (
                <span className="font-medium text-green-600 dark:text-green-400">现在是第 {week} 周</span>
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
                {settings.periods.length > 1 && (
                  <button
                    type="button"
                    aria-label={`删除第 ${periodLabel(i)} 节`}
                    onClick={() => removePeriod(i)}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors active:bg-muted hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addPeriod}
              className="min-h-9 w-full rounded-lg border border-dashed text-xs text-muted-foreground transition-colors active:bg-muted"
            >
              ＋ 添加一节
            </button>
          </div>
        </div>
      </FoldCard>

      <FoldCard title="数据" summary="文件夹同步 / 备份 / 清空">
        {folderOk ? (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">照片存到哪里</h3>
            {!folder || folder.name === null ? (
              <>
                <p className="text-xs text-muted-foreground">
                  {nativeApp
                    ? "照片目前存在本应用内。开启后每张照片会自动存进系统相册「课照助手」，文件管理器里也能看到。"
                    : "照片目前存在本应用内。想让照片以文件形式放进你选的文件夹？选一次文件夹，之后每张照片都会自动放进去。"}
                </p>
                <Button
                  variant="outline"
                  className="min-h-11 w-full"
                  onClick={handlePickFolder}
                >
                  {nativeApp ? "开启自动存入相册" : "选择照片文件夹"}
                </Button>
              </>
            ) : folder.permission === "granted" ? (
              <>
                <p className="text-xs">
                  {nativeApp ? (
                    <>
                      <span className="font-medium text-green-600 dark:text-green-400">照片自动存入系统相册「{folder.name}」</span>
                      <span className="text-muted-foreground">，新照片拍完即存</span>
                    </>
                  ) : (
                    <>
                      <span className="font-medium text-green-600 dark:text-green-400">照片存到「{folder.name}」</span>
                      <span className="text-muted-foreground">，新照片自动放进去</span>
                    </>
                  )}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="min-h-11 flex-1"
                    disabled={syncing}
                    onClick={handleSyncAll}
                  >
                    {syncing ? "放入中…" : "把已有照片放进去"}
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11 flex-1 text-destructive hover:text-destructive"
                    onClick={handleStopSync}
                  >
                    停止
                  </Button>
                </div>
                {nativeApp && (
                  <Button
                    variant="outline"
                    className="min-h-11 w-full"
                    onClick={handleOpenFolder}
                  >
                    打开相册文件夹
                  </Button>
                )}
              </>
            ) : (
              <>
                <p className="text-xs">
                  <span className="font-medium text-amber-600">需要重新授权</span>{" "}
                  <span className="text-muted-foreground">
                    文件夹「{folder.name}」的权限已过期，点一下就能恢复
                  </span>
                </p>
                <Button
                  variant="outline"
                  className="min-h-11 w-full"
                  onClick={handleRegrant}
                >
                  重新授权文件夹
                </Button>
              </>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            这个浏览器不支持选择照片文件夹（安卓 Chrome 或电脑版 Chrome / Edge 可以），
            照片会先存在本应用内，不影响使用。
          </p>
        )}

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {storage
              ? `本应用现有照片 ${storage.photos} 张${storage.trashed > 0 ? `（回收站 ${storage.trashed} 张）` : ""}${storage.usageMB ? ` · 约占 ${storage.usageMB} MB` : ""}`
              : "正在统计照片…"}
          </p>
          <Button
            variant="outline"
            className="min-h-11 w-full"
            disabled={exporting}
            onClick={handleExport}
          >
            {exporting ? "导出中…" : "导出备份（含全部照片）"}
          </Button>
          <Button
            variant="outline"
            className="min-h-11 w-full"
            disabled={restoring}
            onClick={() => restoreRef.current?.click()}
          >
            {restoring ? "读取备份中…" : "从备份恢复"}
          </Button>
          <input
            ref={restoreRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={handleRestorePick}
            aria-label="选择备份文件"
          />
          <Button
            variant="outline"
            className="min-h-11 w-full"
            onClick={() => {
              void loadTrash();
              setTrashOpen(true);
            }}
          >
            回收站{storage && storage.trashed > 0 ? `（${storage.trashed}）` : ""}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {nativeApp
              ? "照片和课表都保存在本应用内，不会上传；卸载应用会清掉应用内数据（系统相册里的照片不受影响），请定期导出备份。"
              : "照片和课表都保存在本应用内（本机浏览器），不会上传；手机上清理浏览器数据或卸载浏览器会一并清掉，请定期导出备份。"}
          </p>
        </div>

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
      </FoldCard>

      <div className="flex items-center justify-between pb-2">
        <p className="text-xs text-muted-foreground">课照助手 · v{appVersion ?? "1.4"}</p>
        {nativeApp && (
          <button
            type="button"
            onClick={() => void handleCheckUpdate()}
            disabled={checking}
            className="text-xs text-muted-foreground underline-offset-2 disabled:opacity-50 hover:underline active:opacity-70"
          >
            {checking ? "检查中…" : "检查更新"}
          </button>
        )}
      </div>
      <input
        ref={xlsRef}
        type="file"
        accept=".xls,.xlsx"
        hidden
        onChange={handleXlsFile}
        aria-label="选择课表文件"
      />
      <input
        ref={aiFileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={onAiFiles}
        aria-label="选择课表截图"
      />
      </div>

      <Dialog open={aiOpen} onOpenChange={(o) => !o && setAiOpen(false)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>AI 识别课表</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                选教务系统课表的截图，可多张（上半/下半各一张也行）
              </p>
              <Button
                variant="outline"
                className="min-h-11 w-full"
                disabled={aiReading}
                onClick={() => aiFileRef.current?.click()}
              >
                {aiReading
                  ? "读取截图中…"
                  : aiImageDataUrls.length > 0
                    ? `已选 ${aiImageDataUrls.length} 张截图，点此重选`
                    : "选择课表截图"}
              </Button>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">没有截图？粘贴课表文字也行（选一个就够）</p>
              <textarea
                value={aiText}
                onChange={(e) => setAiText(e.target.value)}
                rows={4}
                maxLength={8000}
                placeholder="高等数学 周一 1-2节 1-16周 张老师…"
                className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="课表文字"
              />
            </div>
            <Button
              className="w-full"
              disabled={aiBusy || aiReading || (aiImageDataUrls.length === 0 && !aiText.trim())}
              onClick={() => void handleAiParse()}
            >
              {aiBusy ? "AI 识别中…（约十几秒）" : "开始识别"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              识别完可以先预览再导入，课表随时能改
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <UpdateDialog update={update} onClose={() => setUpdate(null)} />

      <Dialog open={pasteOpen} onOpenChange={(o) => !o && setPasteOpen(false)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>从课表文本导入</DialogTitle>
          </DialogHeader>

          {!parsed ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                整段粘贴教务系统的课表，每行一节课。识别「周几、节次、周次、单双周」。
              </p>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={8}
                maxLength={20000}
                placeholder={
                  "高等数学 周一 1-2节 1-16周\n大学英语 周三 3-4节 单周\n数据结构 周五 5-6节 1-3周,5-7周"
                }
                className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="课表文本"
              />
              <Button onClick={doParse} disabled={pasteText.trim().length === 0} className="w-full">
                解析预览
              </Button>
            </div>
          ) : (
            <TimetablePreview
              parsed={parsed}
              droppedFailed={droppedFailed}
              onDropFailed={(i) => setDroppedFailed((prev) => [...prev, i])}
              onBack={() => {
                setParsed(null);
                setDroppedFailed([]);
              }}
              importing={importing}
              onImport={doImport}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={trashOpen} onOpenChange={(o) => !o && setTrashOpen(false)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>回收站</DialogTitle>
          </DialogHeader>
          {deleted.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">回收站是空的</p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                删除的照片在这里保留 {TRASH_DAYS} 天，到期自动清掉。
              </p>
              <div className="grid grid-cols-3 gap-2">
                {deleted.map((p) => {
                  const daysLeft = Math.max(
                    0,
                    Math.ceil(TRASH_DAYS - (Date.now() - (p.deletedAt ?? 0)) / 86400000),
                  );
                  const d = new Date(p.capturedAt);
                  return (
                    <div key={p.id} className="space-y-1">
                      <div
                        className="relative aspect-square overflow-hidden rounded-lg border bg-muted"
                        title={`${d.getMonth() + 1}月${d.getDate()}日`}
                      >
                        {trashUrls.get(p.id) && (
                          <img
                            src={trashUrls.get(p.id)}
                            alt="回收站照片"
                            className="size-full object-cover"
                          />
                        )}
                        <span className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-[10px] leading-4 text-white">
                          剩 {daysLeft} 天
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => void handleRestorePhoto(p.id)}
                          className="min-h-7 flex-1 rounded-md border text-xs active:bg-muted"
                        >
                          恢复
                        </button>
                        <button
                          type="button"
                          aria-label="彻底删除"
                          onClick={() => void handlePurgePhoto(p.id)}
                          className="min-h-7 rounded-md border px-2 text-xs text-destructive active:bg-muted"
                        >
                          彻底删
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="min-h-10 w-full text-destructive hover:text-destructive"
                  >
                    清空回收站
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>清空回收站？</AlertDialogTitle>
                    <AlertDialogDescription>
                      这 {deleted.length} 张照片会被彻底删除，无法恢复。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>先不删</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void handleEmptyTrash()}>
                      彻底删除
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!restorePreview} onOpenChange={(o) => !o && setRestorePreview(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认恢复这份备份？</DialogTitle>
          </DialogHeader>
          {restorePreview && (
            <div className="space-y-3">
              <div className="space-y-1 rounded-lg border bg-muted/30 p-3 text-xs">
                <p>
                  备份导出于{" "}
                  {new Date(restorePreview.preview.exportedAt).toLocaleString("zh-CN", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </p>
                <p>
                  包含 {restorePreview.preview.courses} 门课 ·{" "}
                  {restorePreview.preview.slots} 个时段 · {restorePreview.preview.photos} 张照片
                  （星标 {restorePreview.preview.starred} 张）· 约 {restorePreview.preview.sizeMB} MB
                </p>
                <p className="text-muted-foreground">
                  当前应用里有 {restorePreview.current.courses} 门课 ·{" "}
                  {restorePreview.current.photos} 张照片
                </p>
              </div>
              <p className="text-xs text-destructive">
                恢复会覆盖当前的全部课表、课程和照片，无法撤销。
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setRestorePreview(null)}
                >
                  先不恢复
                </Button>
                <Button
                  className="flex-1"
                  disabled={restoring}
                  onClick={() => void confirmRestore()}
                >
                  {restoring ? "恢复中…" : "确认覆盖恢复"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
