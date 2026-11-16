// 设置页（实施方案 §6）：一级页只做扫读与分流，配置编辑全部下沉子页（深度 ≤2）。
// 子页用单文件内 page 状态切换，不进路由历史；安卓返回键回一级页。
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlarmClock,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  FolderOpen,
  HardDrive,
  Images,
  Info,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { PageShell } from "@/components/page-shell";
import { TimetablePreview } from "@/components/timetable-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  DEFAULT_SETTINGS,
  TRASH_DAYS,
  deletePhoto,
  getSettings,
  listCourses,
  listDeletedPhotos,
  listPhotos,
  replaceAllData,
  restorePhoto,
  savePhotos,
  saveSettings,
} from "@/lib/db";
import { MAX_SEMESTER_WEEKS, getSemesterWeek, weekdayOf } from "@/lib/match";
import { DEFAULT_PERIODS, hhmmToMin, minToHHmm, periodLabel } from "@/lib/periods";
import { applyTimetable, parseTimetableText, type ParseResult } from "@/lib/timetable-parse";
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
import { isNativeApp, openGalleryFolder, shareBackupFile } from "@/lib/native";
import { cn } from "@/lib/utils";
import type { AppSettings, Period, Photo } from "@/lib/types";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const APP_VERSION = "2.1.0";
const WEEK_OPTIONS = [4, 8, 16, 18, 20];

/** 子页状态机（§6.5）：不进路由历史，返回键回一级页 */
type Page =
  | "root"
  | "semester"
  | "periods"
  | "sync"
  | "storage"
  | "data"
  | "trash"
  | "privacy"
  | "whatsnew"
  | "about";

type Stats = { courses: number; photos: number; trashed: number; usage: number | null };
type StorageDetail = {
  origin: number;
  thumb: number;
  other: number;
  total: number;
  photos: number;
  trashed: number;
};
type FolderState = { name: string | null; permission: "granted" | "prompt" | "denied" | null };
type RestorePreview = {
  file: File;
  preview: BackupPreview;
  current: { courses: number; photos: number };
};

function formatSize(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 节次行内校验（§6.6）：开始早于结束 / 与上一节重叠 */
function periodErrors(periods: Period[]): (string | null)[] {
  return periods.map((p, i) => {
    if (p.startMin >= p.endMin) return "开始时间要早于结束时间";
    if (i > 0 && periods[i - 1].endMin > p.startMin) return "和上一节重叠了";
    return null;
  });
}

// ---------- 一级页基础组件 ----------

/** 列表行（§6.3）：高 52px、标题 16px、右侧值 14px 次要色 + chevron、按下背景反馈 */
function Row({
  icon: Icon,
  title,
  value,
  valueDanger,
  onClick,
  busy,
}: {
  icon: LucideIcon;
  title: string;
  value?: string;
  valueDanger?: boolean;
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-muted"
    >
      <Icon className="size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-base">{title}</span>
      {busy ? (
        <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <>
          {value !== undefined && (
            <span
              className={cn(
                "shrink-0 text-sm",
                valueDanger ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {value}
            </span>
          )}
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
        </>
      )}
    </button>
  );
}

/** 组：微信式白色圆角卡（无描边）浮在灰底上，行间缩进分隔线（从图标右侧起） */
function Group({ children }: { children: ReactNode }) {
  return (
    <section>
      <div className="overflow-hidden rounded-xl bg-card [&>*+*]:before:absolute [&>*+*]:before:right-0 [&>*+*]:before:top-0 [&>*+*]:before:h-px [&>*+*]:before:left-[56px] [&>*+*]:before:bg-border/70 [&>*+*]:before:content-[''] [&>*+*]:relative">
        {children}
      </div>
    </section>
  );
}

/** 子页外壳：灰底 + 左上返回 + 标题（返回不回路由历史，只回一级页） */
function SubPage({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="min-h-full bg-muted px-3 pb-10 pt-4 dark:bg-background">
      <div className="mb-4 flex items-center">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回"
          className="-ml-2 flex size-11 items-center justify-center rounded-lg active:bg-muted"
        >
          <ChevronLeft className="size-5" />
        </button>
        <h1 className="text-lg font-semibold">{title}</h1>
      </div>
      {children}
    </div>
  );
}

/** BottomSheet 选项行 */
function SheetOption({
  icon: Icon,
  title,
  desc,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left active:bg-muted"
    >
      <Icon className="size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block text-base">{title}</span>
        <span className="block text-[13px] text-muted-foreground">{desc}</span>
      </span>
    </button>
  );
}

// ---------- 静态文案 ----------

const WHATS_NEW: { version: string; items: string[] }[] = [
  {
    version: APP_VERSION,
    items: [
      "设置页全新改版：微信式分组列表，更清爽",
      "AI 转课表提示词增强：防漏课、自动合并跨大节课",
      "移除「导入文件」：教务课表格式多样，本地直读不可靠，改用 AI 转课表或粘贴文字更稳",
    ],
  },
  {
    version: "2.0.0",
    items: [
      "全新仓库重新出发，安装包更小",
      "纯离线运行：不联网、不收集任何数据",
      "新增 AI 转课表：复制提示词给任意 AI，粘回结果即可导入",
      "课表支持填写教室，周视图显示「课程名 · 教室」",
      "设置页整页重设计：分组列表 + 子页，找任何设置不超过两步",
    ],
  },
];

const PRIVACY_SECTIONS: { h: string; p: string }[] = [
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

const OPEN_SOURCE: [string, string][] = [
  ["React", "MIT"],
  ["TanStack Router", "MIT"],
  ["Radix UI", "MIT"],
  ["vaul", "MIT"],
  ["sonner", "MIT"],
  ["lucide-react", "ISC"],
  ["idb", "ISC"],
  ["xlsx", "Apache-2.0"],
  ["Tailwind CSS", "MIT"],
  ["exifr", "MIT"],
];

// ---------- 子页 ----------

function SemesterPage({
  settings,
  onBack,
  onDate,
  onOpenWeeks,
}: {
  settings: AppSettings;
  onBack: () => void;
  onDate: (v: string) => void;
  onOpenWeeks: () => void;
}) {
  const week = settings.semesterStart ? getSemesterWeek(Date.now(), settings.semesterStart) : null;
  return (
    <SubPage title="课表设置" onBack={onBack}>
      <div className="space-y-5">
        <div>
          <p className="px-1 pb-1.5 text-[13px] text-muted-foreground">学期起始日（第 1 周周一）</p>
          <Input
            type="date"
            value={settings.semesterStart}
            onChange={(e) => onDate(e.target.value)}
            className="min-h-12"
            aria-label="学期起始日"
          />
          <p className="px-1 pt-2 text-[13px] leading-relaxed text-muted-foreground">
            第 1 周的周一。拍照归档靠它算第几周。
          </p>
          {settings.semesterStart ? (
            week !== null ? (
              <p className="px-1 pt-1 text-[13px] font-medium text-green-600 dark:text-green-400">
                现在是第 {week} 周
              </p>
            ) : (
              <p className="px-1 pt-1 text-[13px] text-destructive">
                当前日期不在学期范围内（1-{MAX_SEMESTER_WEEKS} 周），请检查日期
              </p>
            )
          ) : (
            <p className="px-1 pt-1 text-[13px] text-destructive">未设置</p>
          )}
        </div>
        <div>
          <p className="px-1 pb-1.5 text-[13px] text-muted-foreground">默认周数</p>
          <div className="overflow-hidden rounded-xl bg-card">
            <Row
              icon={CalendarDays}
              title="默认周数"
              value={`${settings.defaultWeeks} 周`}
              onClick={onOpenWeeks}
            />
          </div>
          <p className="px-1 pt-2 text-[13px] leading-relaxed text-muted-foreground">
            导入课表没写周次时，按这个周数补齐。
          </p>
        </div>
      </div>
    </SubPage>
  );
}

function PeriodsPage({
  settings,
  onBack,
  onUpdate,
  onAdd,
  onRemove,
  onRestoreDefault,
}: {
  settings: AppSettings;
  onBack: () => void;
  onUpdate: (i: number, which: "start" | "end", text: string) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
  onRestoreDefault: () => void;
}) {
  const errors = periodErrors(settings.periods);
  const last = settings.periods[settings.periods.length - 1];
  const nextStart = Math.min(last.endMin + 15, 23 * 60);
  const canAdd = nextStart < Math.min(nextStart + 95, 23 * 60 + 59);
  return (
    <SubPage title="节次作息" onBack={onBack}>
      <div className="overflow-hidden rounded-xl bg-card">
        {settings.periods.map((p, i) => (
          <div key={i} className={i === 0 ? "" : "border-t"}>
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="w-14 shrink-0 text-sm font-medium">{periodLabel(i)} 节</span>
              <Input
                type="time"
                value={minToHHmm(p.startMin)}
                onChange={(e) => onUpdate(i, "start", e.target.value)}
                className="min-h-11 flex-1"
                aria-label={`第 ${periodLabel(i)} 节开始时间`}
              />
              <span className="text-[13px] text-muted-foreground">–</span>
              <Input
                type="time"
                value={minToHHmm(p.endMin)}
                onChange={(e) => onUpdate(i, "end", e.target.value)}
                className="min-h-11 flex-1"
                aria-label={`第 ${periodLabel(i)} 节结束时间`}
              />
              {settings.periods.length > 1 && (
                <button
                  type="button"
                  aria-label={`删除第 ${periodLabel(i)} 节`}
                  onClick={() => onRemove(i)}
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground active:bg-muted active:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
            {errors[i] && <p className="px-3 pb-2 text-[13px] text-destructive">{errors[i]}</p>}
          </div>
        ))}
        <button
          type="button"
          onClick={onAdd}
          disabled={!canAdd}
          className="flex min-h-12 w-full items-center justify-center border-t border-dashed text-sm text-muted-foreground active:bg-muted disabled:opacity-50"
        >
          ＋ 添加一节
        </button>
      </div>
      {!canAdd && (
        <p className="px-1 pt-2 text-[13px] text-destructive">已经到深夜了，加不下新的一节</p>
      )}
      <div className="pt-4">
        <Button variant="outline" className="min-h-11 w-full border-0 bg-card" onClick={onRestoreDefault}>
          恢复默认模板
        </Button>
      </div>
      <p className="px-1 pt-3 text-[13px] leading-relaxed text-muted-foreground">
        改动即时保存。节次时间决定拍照归档的匹配，改完看一眼课表页是否正常。
      </p>
    </SubPage>
  );
}

function SyncPage({
  folder,
  syncing,
  onBack,
  onEnable,
  onSync,
  onRegrant,
  onStop,
  onOpenGallery,
}: {
  folder: FolderState | null;
  syncing: boolean;
  onBack: () => void;
  onEnable: () => void;
  onSync: () => void;
  onRegrant: () => void;
  onStop: () => void;
  onOpenGallery: () => void;
}) {
  const enabled = !!folder?.name && folder.permission === "granted";
  const expired = !!folder?.name && folder.permission !== "granted";
  return (
    <SubPage title="照片与相册" onBack={onBack}>
      {!folderSupported() ? (
        <p className="px-1 text-sm leading-relaxed text-muted-foreground">
          当前环境不支持系统相册同步，照片存在应用内，不影响使用。
        </p>
      ) : enabled ? (
        <>
          <p className="px-1 text-xl font-semibold text-green-600 dark:text-green-400">
            已开启 · 系统相册「课照助手」
          </p>
          <p className="px-1 pt-2 text-sm leading-relaxed text-muted-foreground">
            新拍的照片会自动存入系统相册，按科目分文件夹存放。以后想在相册里翻板书，直接去「课照助手」文件夹。
          </p>
          <div className="flex flex-wrap gap-2 pt-4">
            <Button variant="outline" className="min-h-11 border-0 bg-card" onClick={onOpenGallery}>
              <FolderOpen className="size-4" />
              查看相册
            </Button>
            <Button variant="outline" className="min-h-11 border-0 bg-card" disabled={syncing} onClick={onSync}>
              {syncing ? "同步中…" : "同步全部"}
            </Button>
          </div>
          <div className="mt-6 rounded-xl bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">停止同步</p>
            <p className="pt-1 text-[13px] leading-relaxed text-muted-foreground">
              停止后新拍的照片只存应用内，已存进相册的文件不受影响。
            </p>
            <Button
              variant="outline"
              className="mt-3 min-h-11 w-full border-0 bg-card text-destructive hover:text-destructive"
              onClick={onStop}
            >
              停止同步
            </Button>
          </div>
        </>
      ) : expired ? (
        <>
          <p className="px-1 text-xl font-semibold">同步已暂停</p>
          <p className="px-1 pt-2 text-sm leading-relaxed text-muted-foreground">
            相册授权已过期，重新授权后继续自动存入系统相册。
          </p>
          <div className="pt-4">
            <Button className="min-h-11 w-full" onClick={onRegrant}>
              重新授权
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="px-1 text-xl font-semibold">照片只存在应用内</p>
          <p className="px-1 pt-2 text-sm leading-relaxed text-muted-foreground">
            照片默认只存在应用里。开启后，拍的照片会同时存进系统相册「课照助手」，按科目分文件夹，卸载应用也不会丢。
          </p>
          <div className="pt-4">
            <Button className="min-h-11 w-full" disabled={syncing} onClick={onEnable}>
              {syncing ? "放入中…" : "存入系统相册"}
            </Button>
          </div>
        </>
      )}
    </SubPage>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={cn("size-2.5 shrink-0 rounded-sm", color)} />
      <span className="flex-1">{label}</span>
      <span className="text-[13px] text-muted-foreground">{value}</span>
    </div>
  );
}

function StoragePage({
  detail,
  loading,
  clearingThumbs,
  onBack,
  onClearThumbs,
}: {
  detail: StorageDetail | null;
  loading: boolean;
  clearingThumbs: boolean;
  onBack: () => void;
  onClearThumbs: () => void;
}) {
  const pct = (n: number) => (detail && detail.total > 0 ? `${(n / detail.total) * 100}%` : "0%");
  return (
    <SubPage title="存储空间" onBack={onBack}>
      {loading && !detail ? (
        <p className="px-1 text-sm text-muted-foreground">正在统计…</p>
      ) : !detail || detail.photos === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">还没有照片</p>
      ) : (
        <>
          <div className="flex h-3.5 overflow-hidden rounded-full bg-muted">
            {detail.origin > 0 && (
              <span className="h-full bg-blue-600" style={{ width: pct(detail.origin) }} />
            )}
            {detail.thumb > 0 && (
              <span className="h-full bg-emerald-600" style={{ width: pct(detail.thumb) }} />
            )}
            {detail.other > 0 && (
              <span className="h-full bg-muted-foreground/40" style={{ width: pct(detail.other) }} />
            )}
          </div>
          <div className="space-y-2 pt-3">
            <Legend color="bg-blue-600" label="原图" value={formatSize(detail.origin)} />
            <Legend color="bg-emerald-600" label="缩略图" value={formatSize(detail.thumb)} />
            <Legend color="bg-muted-foreground/40" label="其他" value={formatSize(detail.other)} />
          </div>
          <p className="px-1 pt-3 text-[13px] text-muted-foreground">
            合计约 {formatSize(detail.total)} · 照片 {detail.photos} 张 · 回收站 {detail.trashed} 张
          </p>
          <div className="pt-4">
            <Button
              variant="outline"
              className="min-h-11 w-full border-0 bg-card"
              disabled={clearingThumbs}
              onClick={onClearThumbs}
            >
              {clearingThumbs ? "清理中…" : "清理缩略图缓存"}
            </Button>
          </div>
          <p className="px-1 pt-3 text-[13px] leading-relaxed text-muted-foreground">
            缩略图只是列表里的小图，清理后打开课程相册会按需重新生成，不影响原图。
          </p>
        </>
      )}
    </SubPage>
  );
}

function DataPage({
  exporting,
  exportError,
  restoring,
  clearing,
  photoCount,
  onBack,
  onExport,
  onRestore,
  onClearAll,
}: {
  exporting: boolean;
  exportError: string;
  restoring: boolean;
  clearing: boolean;
  photoCount: number;
  onBack: () => void;
  onExport: () => void;
  onRestore: () => void;
  onClearAll: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <SubPage title="数据与备份" onBack={onBack}>
      <div className="divide-y overflow-hidden rounded-2xl border bg-card">
        <Row icon={Upload} title="导出备份" onClick={onExport} busy={exporting} />
        <Row icon={RotateCcw} title="从备份恢复" onClick={onRestore} busy={restoring} />
      </div>
      {exportError && <p className="px-1 pt-2 text-sm text-destructive">{exportError}</p>}
      <p className="px-1 pt-3 text-[13px] leading-relaxed text-muted-foreground">
        照片只存本机不上传，卸载即清空——记得定期导出备份。
      </p>
      <div className="mt-6 rounded-xl bg-destructive/5 p-4">
        <p className="text-sm font-semibold text-destructive">清空所有数据</p>
        <p className="pt-1 text-[13px] leading-relaxed text-muted-foreground">
          课表、课程和 {photoCount} 张照片都会删除，无法恢复。清空前建议先导出一份备份。
        </p>
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              className="mt-3 min-h-11 w-full border-0 bg-card text-destructive hover:text-destructive"
            >
              全部清空
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>清空全部数据？</AlertDialogTitle>
              <AlertDialogDescription>
                课表、课程和 {photoCount} 张照片都会删除，无法恢复。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>先不清</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={clearing}
                onClick={onClearAll}
              >
                {clearing ? "清空中…" : "全部清空"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </SubPage>
  );
}

function TrashPage({
  trash,
  trashUrls,
  onBack,
  onRestorePhoto,
  onPurgePhoto,
  onEmptyTrash,
}: {
  trash: Photo[];
  trashUrls: Map<string, string>;
  onBack: () => void;
  onRestorePhoto: (id: string) => void;
  onPurgePhoto: (id: string) => void;
  onEmptyTrash: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <SubPage title="回收站" onBack={onBack}>
      {trash.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">回收站是空的</p>
      ) : (
        <>
          <p className="px-1 pb-3 text-[13px] text-muted-foreground">
            删除的照片在这里保留 {TRASH_DAYS} 天，到期自动清掉。
          </p>
          <div className="grid grid-cols-3 gap-2">
            {trash.map((p) => {
              const daysLeft = Math.max(
                0,
                Math.ceil(TRASH_DAYS - (Date.now() - (p.deletedAt ?? 0)) / 86400000),
              );
              return (
                <div key={p.id} className="space-y-1">
                  <div className="relative aspect-square overflow-hidden rounded-lg border bg-muted">
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
                      onClick={() => onRestorePhoto(p.id)}
                      className="min-h-11 flex-1 rounded-md border text-xs active:bg-muted"
                    >
                      恢复
                    </button>
                    <button
                      type="button"
                      aria-label="彻底删除"
                      onClick={() => onPurgePhoto(p.id)}
                      className="min-h-11 rounded-md border px-2 text-xs text-destructive active:bg-muted"
                    >
                      彻底删
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-6 rounded-xl bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">清空回收站</p>
            <p className="pt-1 text-[13px] leading-relaxed text-muted-foreground">
              这 {trash.length} 张照片会被彻底删除，无法恢复。
            </p>
            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              className="mt-3 min-h-11 w-full border-0 bg-card text-destructive hover:text-destructive"
            >
              彻底删除
            </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>清空回收站？</AlertDialogTitle>
                  <AlertDialogDescription>
                    这 {trash.length} 张照片会被彻底删除，无法恢复。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>先不删</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={onEmptyTrash}
                  >
                    彻底删除
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </>
      )}
    </SubPage>
  );
}

function PrivacyPage({ onBack }: { onBack: () => void }) {
  return (
    <SubPage title="隐私政策" onBack={onBack}>
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          课照助手是一款完全离线的课堂拍照归档工具。我们把「不收集」当作功能来设计，而不是口号。
        </p>
        {PRIVACY_SECTIONS.map((s) => (
          <div key={s.h}>
            <h3 className="px-1 pb-1 text-[15px] font-semibold">{s.h}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{s.p}</p>
          </div>
        ))}
      </div>
    </SubPage>
  );
}

function WhatsNewPage({ onBack }: { onBack: () => void }) {
  return (
    <SubPage title="更新说明" onBack={onBack}>
      {WHATS_NEW.map((v) => (
        <div key={v.version}>
          <p className="px-1 pb-1 text-[15px] font-semibold">
            {v.version}
            {v.version === APP_VERSION ? "（当前版本）" : ""}
          </p>
          <ul className="list-disc space-y-1 pl-6">
            {v.items.map((it) => (
              <li key={it} className="text-sm leading-relaxed text-muted-foreground">
                {it}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="px-1 pt-4 text-[13px] leading-relaxed text-muted-foreground">
        更早的版本记录已随旧版归档，不再展示。
      </p>
    </SubPage>
  );
}

function AboutPage({ onBack }: { onBack: () => void }) {
  return (
    <SubPage title="关于课照助手" onBack={onBack}>
      <p className="py-6 text-center text-2xl font-semibold">v{APP_VERSION}</p>
      <p className="text-center text-sm leading-relaxed text-muted-foreground">
        本应用不联网、不收集任何数据，
        <br />
        你的课表和照片只存在这台手机。
      </p>
      <h3 className="px-1 pb-2 pt-8 text-[15px] font-semibold">开源许可</h3>
      <ul className="list-disc space-y-1 pl-6">
        {OPEN_SOURCE.map(([name, license]) => (
          <li key={name} className="text-sm leading-relaxed text-muted-foreground">
            {name} · {license}
          </li>
        ))}
      </ul>
    </SubPage>
  );
}

// ---------- 页面 ----------

function SettingsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState<Page>("root");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [folder, setFolder] = useState<FolderState | null>(null);

  // 录入课表
  const [importSheet, setImportSheet] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [droppedFailed, setDroppedFailed] = useState<number[]>([]);
  const [importing, setImporting] = useState(false);

  // 默认周数
  const [weeksOpen, setWeeksOpen] = useState(false);
  const [weeksCustom, setWeeksCustom] = useState(false);
  const [weeksCustomText, setWeeksCustomText] = useState("");
  const [weeksError, setWeeksError] = useState("");

  // 备份
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

  // 回收站
  const [trash, setTrash] = useState<Photo[]>([]);
  const [trashUrls, setTrashUrls] = useState<Map<string, string>>(new Map());

  // 存储空间
  const [storageDetail, setStorageDetail] = useState<StorageDetail | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [clearingThumbs, setClearingThumbs] = useState(false);

  // 其他进行时状态
  const [syncing, setSyncing] = useState(false);
  const [clearing, setClearing] = useState(false);

  /** 挂载查一次 + 回一级页刷新（§6.3：禁止 render 内查询） */
  const load = useCallback(() => {
    void (async () => {
      try {
        const [courses, photos, trashed, s] = await Promise.all([
          listCourses(),
          listPhotos(),
          listDeletedPhotos(),
          getSettings(),
        ]);
        let usage: number | null = null;
        try {
          const est = await navigator.storage?.estimate?.();
          usage = est?.usage ?? null;
        } catch {
          /* 部分环境不支持容量估算，占用显示 — */
        }
        setStats({
          courses: courses.length,
          photos: photos.length,
          trashed: trashed.length,
          usage,
        });
        setSettings(s);
      } catch {
        /* 统计失败不阻塞列表 */
      }
      if (folderSupported()) {
        try {
          setFolder(await folderState());
        } catch {
          setFolder(null);
        }
      }
    })();
  }, []);

  useEffect(() => {
    if (page === "root") load();
  }, [page, load]);

  useEffect(() => {
    if (page === "trash") void listDeletedPhotos().then(setTrash);
  }, [page]);

  const loadStorageDetail = useCallback(() => {
    setStorageLoading(true);
    void (async () => {
      try {
        const [photos, trashed] = await Promise.all([listPhotos(), listDeletedPhotos()]);
        let origin = 0;
        let thumb = 0;
        for (const p of photos) {
          origin += p.blob?.size ?? 0;
          thumb += p.thumb?.size ?? 0;
        }
        let total = origin + thumb;
        let other = 0;
        try {
          const est = await navigator.storage?.estimate?.();
          if (est?.usage && est.usage > total) {
            total = est.usage;
            other = total - origin - thumb;
          }
        } catch {
          /* 不支持容量估算时只统计照片本身 */
        }
        setStorageDetail({
          origin,
          thumb,
          other,
          total,
          photos: photos.length,
          trashed: trashed.length,
        });
      } catch {
        setStorageDetail(null);
      } finally {
        setStorageLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (page === "storage") loadStorageDetail();
  }, [page, loadStorageDetail]);

  // 回收站缩略图 URL：随 trash 重建，卸载/切换时撤销
  useEffect(() => {
    const next = new Map<string, string>();
    for (const p of trash) {
      const src = (p.thumb ?? p.blob) as Blob | undefined;
      if (src) next.set(p.id, URL.createObjectURL(src));
    }
    setTrashUrls(next);
    return () => next.forEach((u) => URL.revokeObjectURL(u));
  }, [trash]);

  // 看过更新说明即标记已读（本机记录）
  useEffect(() => {
    if (page !== "whatsnew" || !settings) return;
    if (settings.seenWhatsNew === APP_VERSION) return;
    const next = { ...settings, seenWhatsNew: APP_VERSION };
    setSettings(next);
    void saveSettings(next);
  }, [page, settings]);

  // 安卓返回键：子页内先回一级页（§6.5）。native.ts 的微信模式处理器仍会把 /settings
  // 当 Tab 根弹出「再按一次退出」，这里返回后立即收掉该 toast
  useEffect(() => {
    if (page === "root" || !isNativeApp()) return;
    let cancelled = false;
    let remove: (() => void) | null = null;
    void import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("backButton", () => {
          setPage("root");
          toast.dismiss();
        }),
      )
      .then((h) => {
        if (cancelled) void h.remove();
        else remove = () => void h.remove();
      });
    return () => {
      cancelled = true;
      remove?.();
    };
  }, [page]);

  if (!settings) return null;
  // 闭包内的处理器拿不到守卫收窄，用常量别名
  const s = settings;

  const persist = (next: AppSettings) => {
    setSettings(next);
    void saveSettings(next);
  };

  // ---------- 录入课表 ----------

  function openImportSheet() {
    setImportSheet(true);
  }

  function openPaste() {
    setImportSheet(false);
    setPasteText("");
    setParsed(null);
    setDroppedFailed([]);
    setPasteOpen(true);
  }

  function doParse() {
    const result = parseTimetableText(pasteText, s.periods);
    setDroppedFailed([]);
    setParsed(result);
    if (result.ok.length === 0) {
      toast.error("没解析出任何课程，对照示例检查一下格式");
    }
  }

  async function doImport() {
    if (!parsed) return;
    setImporting(true);
    try {
      const n = await applyTimetable(parsed.ok, s.periods);
      toast.success(`已导入 ${parsed.ok.length} 门课 · ${n} 个时段`, {
        description: "改过课表后，可到「待分类」一键重新匹配已有照片",
      });
      setPasteOpen(false);
      setParsed(null);
      load();
    } catch {
      toast.error("导入失败，重试一次");
    } finally {
      setImporting(false);
    }
  }

  // ---------- 默认周数 ----------

  function openWeeks() {
    setWeeksCustom(false);
    setWeeksCustomText("");
    setWeeksError("");
    setWeeksOpen(true);
  }

  function chooseWeeks(n: number) {
    persist({ ...s, defaultWeeks: n });
    setWeeksOpen(false);
  }

  function confirmCustomWeeks() {
    const n = Number(weeksCustomText);
    if (!Number.isInteger(n) || n < 1 || n > MAX_SEMESTER_WEEKS) {
      setWeeksError(`周数要在 1 到 ${MAX_SEMESTER_WEEKS} 之间`);
      return;
    }
    chooseWeeks(n);
  }

  // ---------- 课表设置 ----------

  function onSemesterDate(v: string) {
    if (!v) {
      persist({ ...s, semesterStart: "" });
      return;
    }
    // 周次锚点必须是周一，靠代码保证而不是靠用户记文案
    const [y, m, d] = v.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const wd = weekdayOf(date.getTime());
    if (wd !== 1) {
      date.setDate(date.getDate() - (wd - 1));
      const pad = (n: number) => String(n).padStart(2, "0");
      persist({
        ...s,
        semesterStart: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      });
      toast(`第 1 周从周一起算，已自动对齐到 ${date.getMonth() + 1}月${date.getDate()}日`);
    } else {
      persist({ ...s, semesterStart: v });
    }
  }

  function updatePeriod(i: number, which: "start" | "end", text: string) {
    const min = hhmmToMin(text);
    if (min === null) return;
    const periods = s.periods.map((p, idx) => {
      if (idx !== i) return p;
      return which === "start" ? { ...p, startMin: min } : { ...p, endMin: min };
    });
    // 非法值也落库，行内红字提示用户改回； match 侧对 start>=end 的节次自然不命中
    persist({ ...s, periods });
  }

  function addPeriod() {
    const last = s.periods[s.periods.length - 1];
    const startMin = Math.min(last.endMin + 15, 23 * 60);
    const endMin = Math.min(startMin + 95, 23 * 60 + 59);
    persist({ ...s, periods: [...s.periods, { startMin, endMin }] });
  }

  function removePeriod(i: number) {
    persist({ ...s, periods: s.periods.filter((_, idx) => idx !== i) });
  }

  function restoreDefaultPeriods() {
    persist({ ...s, periods: DEFAULT_PERIODS.map((p) => ({ ...p })) });
    toast.success("已恢复默认节次时间");
  }

  // ---------- 备份 ----------

  async function handleExport() {
    setExporting(true);
    setExportError("");
    try {
      if (isNativeApp()) {
        // 流式逐块写缓存文件再分享，几百张照片内存占用也恒定
        await shareBackupFile(backupChunks, backupFilename());
      } else {
        const { blob, filename } = await exportBackup();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
      await markBackupDone();
      toast.success("备份好了，发到哪里你来定");
      load();
    } catch {
      setExportError("导出失败，重试一次");
    } finally {
      setExporting(false);
    }
  }

  async function onRestorePicked(e: ChangeEvent<HTMLInputElement>) {
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
    } catch {
      toast.error("文件读取失败，重新选一次试试");
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
      load();
    } catch {
      toast.error("恢复失败，确认选择的是本应用导出的备份文件");
    } finally {
      setRestoring(false);
    }
  }

  async function handleClearAll() {
    setClearing(true);
    try {
      // 空数据 + 设置重置为默认值；DEFAULT_SETTINGS 不带 privacyAgreedAt，
      // 隐私同意状态随之清除（T11 首启同意弹窗依赖「清数据重启再弹」）
      await replaceAllData(
        { ...DEFAULT_SETTINGS, periods: DEFAULT_PERIODS.map((p) => ({ ...p })) },
        [],
        [],
        [],
      );
      setPage("root");
      load();
      toast.success("已清空全部数据");
    } catch {
      toast.error("清空失败，重试一次");
    } finally {
      setClearing(false);
    }
  }

  // ---------- 回收站 ----------

  async function handleRestorePhoto(id: string) {
    await restorePhoto(id);
    setTrash((prev) => prev.filter((p) => p.id !== id));
    load();
  }

  async function handlePurgePhoto(id: string) {
    await deletePhoto(id);
    setTrash((prev) => prev.filter((p) => p.id !== id));
    load();
  }

  async function handleEmptyTrash() {
    setClearing(true);
    try {
      for (const p of trash) await deletePhoto(p.id);
      setTrash([]);
      load();
      toast.success("回收站已清空");
    } catch {
      toast.error("清空回收站失败，重试一次");
    } finally {
      setClearing(false);
    }
  }

  // ---------- 照片与相册 ----------

  async function handleEnableSync() {
    try {
      const name = await pickFolder();
      if (!name) {
        setFolder(await folderState());
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
        // 全量同步失败不阻断，可手动再点「同步全部」
      } finally {
        setSyncing(false);
      }
      setFolder(await folderState());
    } catch {
      // 用户取消选择
    }
  }

  async function handleSyncAll() {
    setSyncing(true);
    try {
      const { ok, fail } = await syncAllPhotos();
      if (ok + fail === 0) toast("没有需要同步的照片");
      else {
        toast.success(`已同步 ${ok} 张${fail > 0 ? `，失败 ${fail} 张` : ""}`, {
          description: "在系统相册「课照助手」里可见",
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "同步失败");
    } finally {
      setSyncing(false);
      setFolder(await folderState());
    }
  }

  async function handleRegrant() {
    const ok = await regrantFolder();
    if (!ok) toast.error("授权没有通过，再点一次试试");
    setFolder(await folderState());
  }

  async function handleStopSync() {
    await stopFolderSync();
    toast("已停止自动存入相册");
    setFolder(await folderState());
  }

  async function handleOpenGallery() {
    try {
      const via = await openGalleryFolder();
      if (via === "gallery") {
        toast("已打开系统相册", { description: "在相册里找到「课照助手」文件夹即可" });
      }
    } catch {
      toast.error("打不开文件管理器", {
        description: "可手动前往 文件管理器 → Pictures/课照助手 查看",
      });
    }
  }

  // ---------- 存储空间 ----------

  async function handleClearThumbs() {
    setClearingThumbs(true);
    try {
      const photos = await listPhotos();
      const withThumb = photos.filter((p) => p.thumb);
      if (withThumb.length === 0) {
        toast("没有可清理的缩略图缓存");
        return;
      }
      let freed = 0;
      const stripped = withThumb.map((p) => {
        freed += p.thumb?.size ?? 0;
        const { thumb: _dropped, ...rest } = p;
        return rest;
      });
      await savePhotos(stripped);
      loadStorageDetail();
      toast.success(`已清理缩略图缓存，释放约 ${formatSize(freed)}`);
    } catch {
      toast.error("清理失败，重试一次");
    } finally {
      setClearingThumbs(false);
    }
  }

  // ---------- 渲染 ----------

  const backToRoot = () => setPage("root");

  const root = (
    <div className="min-h-full space-y-2 bg-muted px-3 pb-10 dark:bg-background">
      <h1 className="px-2 pb-1 pt-5 text-xl font-semibold">设置</h1>

      <Group>
        <Row icon={CalendarPlus} title="录入课表" onClick={openImportSheet} />
        <Row icon={CalendarRange} title="管理课表" onClick={() => navigate({ to: "/schedule" })} />
        <Row
          icon={CalendarClock}
          title="学期起始日"
          value={
            settings.semesterStart
              ? `${Number(settings.semesterStart.split("-")[1])}月${Number(
                  settings.semesterStart.split("-")[2],
                )}日 · ${
                  getSemesterWeek(Date.now(), settings.semesterStart) !== null
                    ? `第${getSemesterWeek(Date.now(), settings.semesterStart)}周`
                    : "超范围"
                }`
              : "未设置"
          }
          valueDanger={!settings.semesterStart}
          onClick={() => setPage("semester")}
        />
        <Row
          icon={AlarmClock}
          title="节次作息"
          value={`每天 ${settings.periods.length} 大节`}
          onClick={() => setPage("periods")}
        />
        <Row
          icon={CalendarDays}
          title="默认周数"
          value={`${settings.defaultWeeks} 周`}
          onClick={openWeeks}
        />
      </Group>

      <Group>
        <Row
          icon={Images}
          title="系统相册同步"
          value={
            !folderSupported()
              ? "未支持"
              : folder === null
                ? "—"
                : folder.name === null
                  ? "未开启"
                  : folder.permission === "granted"
                    ? "已开启"
                    : "已过期"
          }
          onClick={() => setPage("sync")}
        />
        <Row
          icon={HardDrive}
          title="存储空间"
          value={stats?.usage ? formatSize(stats.usage) : "—"}
          onClick={() => setPage("storage")}
        />
      </Group>

      <Group>
        {/* §6.7 第 10 行：一级页两行为动作行直接执行；「数据与备份」子页各保留一份 + 清空危险区 */}
        <Row icon={Upload} title="导出备份" onClick={() => void handleExport()} busy={exporting} />
        <Row
          icon={RotateCcw}
          title="从备份恢复"
          onClick={() => restoreRef.current?.click()}
          busy={restoring}
        />
        <Row
          icon={Trash2}
          title="回收站"
          value={stats ? (stats.trashed > 0 ? `${stats.trashed} 张` : "空") : "—"}
          onClick={() => setPage("trash")}
        />
      </Group>
      {exportError && <p className="px-1 text-sm text-destructive">{exportError}</p>}

      <Group>
        <Row icon={ShieldCheck} title="隐私政策" onClick={() => setPage("privacy")} />
        <Row icon={Sparkles} title="更新说明" onClick={() => setPage("whatsnew")} />
        <Row
          icon={Info}
          title="关于课照助手"
          value={`v${APP_VERSION}`}
          onClick={() => setPage("about")}
        />
      </Group>
    </div>
  );

  let sub: ReactNode = null;
  switch (page) {
    case "semester":
      sub = (
        <SemesterPage
          settings={settings}
          onBack={backToRoot}
          onDate={onSemesterDate}
          onOpenWeeks={openWeeks}
        />
      );
      break;
    case "periods":
      sub = (
        <PeriodsPage
          settings={settings}
          onBack={backToRoot}
          onUpdate={updatePeriod}
          onAdd={addPeriod}
          onRemove={removePeriod}
          onRestoreDefault={restoreDefaultPeriods}
        />
      );
      break;
    case "sync":
      sub = (
        <SyncPage
          folder={folder}
          syncing={syncing}
          onBack={backToRoot}
          onEnable={() => void handleEnableSync()}
          onSync={() => void handleSyncAll()}
          onRegrant={() => void handleRegrant()}
          onStop={() => void handleStopSync()}
          onOpenGallery={() => void handleOpenGallery()}
        />
      );
      break;
    case "storage":
      sub = (
        <StoragePage
          detail={storageDetail}
          loading={storageLoading}
          clearingThumbs={clearingThumbs}
          onBack={backToRoot}
          onClearThumbs={() => void handleClearThumbs()}
        />
      );
      break;
    case "data":
      sub = (
        <DataPage
          exporting={exporting}
          exportError={exportError}
          restoring={restoring}
          clearing={clearing}
          photoCount={stats?.photos ?? 0}
          onBack={backToRoot}
          onExport={() => void handleExport()}
          onRestore={() => restoreRef.current?.click()}
          onClearAll={() => void handleClearAll()}
        />
      );
      break;
    case "trash":
      sub = (
        <TrashPage
          trash={trash}
          trashUrls={trashUrls}
          onBack={backToRoot}
          onRestorePhoto={(id) => void handleRestorePhoto(id)}
          onPurgePhoto={(id) => void handlePurgePhoto(id)}
          onEmptyTrash={() => void handleEmptyTrash()}
        />
      );
      break;
    case "privacy":
      sub = <PrivacyPage onBack={backToRoot} />;
      break;
    case "whatsnew":
      sub = <WhatsNewPage onBack={backToRoot} />;
      break;
    case "about":
      sub = <AboutPage onBack={backToRoot} />;
      break;
  }

  return (
    <PageShell>
      {page === "root" ? root : sub}

      {/* 隐藏文件选择框：备份恢复用 */}
      <input
        ref={restoreRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => void onRestorePicked(e)}
        aria-label="选择备份文件"
      />

      {/* 录入课表三选一 */}
      <Drawer open={importSheet} onOpenChange={setImportSheet}>
        <DrawerContent className="pb-6">
          <DrawerHeader>
            <DrawerTitle>录入课表</DrawerTitle>
          </DrawerHeader>
          <div className="px-2">
            <SheetOption icon={ClipboardPaste} title="粘贴文字" desc="每行一节课" onClick={openPaste} />
            <SheetOption
              icon={Sparkles}
              title="AI 转课表"
              desc="复制提示词给任意 AI"
              onClick={() => navigate({ to: "/import-ai" })}
            />
          </div>
          <div className="px-4 pt-2">
            <button
              type="button"
              onClick={() => {
                setImportSheet(false);
                navigate({ to: "/schedule" });
              }}
              className="min-h-11 w-full text-[13px] text-muted-foreground"
            >
              单节课可直接在课表页点空格添加 ›
            </button>
          </div>
        </DrawerContent>
      </Drawer>

      {/* 默认周数单选 */}
      <Drawer open={weeksOpen} onOpenChange={setWeeksOpen}>
        <DrawerContent className="pb-6">
          <DrawerHeader>
            <DrawerTitle>默认周数</DrawerTitle>
            <DrawerDescription>导入课表没写周次时，按这个周数补齐。</DrawerDescription>
          </DrawerHeader>
          <div className="px-2">
            {WEEK_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => chooseWeeks(n)}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base active:bg-muted"
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border-2",
                    settings.defaultWeeks === n ? "border-primary" : "border-muted-foreground",
                  )}
                >
                  {settings.defaultWeeks === n && <span className="size-2.5 rounded-full bg-primary" />}
                </span>
                {n} 周
              </button>
            ))}
            <button
              type="button"
              onClick={() => setWeeksCustom(true)}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base active:bg-muted"
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border-2",
                  weeksCustom ? "border-primary" : "border-muted-foreground",
                )}
              >
                {weeksCustom && <span className="size-2.5 rounded-full bg-primary" />}
              </span>
              自定义
            </button>
            {weeksCustom && (
              <div className="flex items-center gap-2 px-3 pt-2">
                <Input
                  type="number"
                  min={1}
                  max={MAX_SEMESTER_WEEKS}
                  value={weeksCustomText}
                  onChange={(e) => setWeeksCustomText(e.target.value)}
                  placeholder="输入周数"
                  className="min-h-11"
                  aria-label="自定义周数"
                />
                <Button className="min-h-11" onClick={confirmCustomWeeks}>
                  确定
                </Button>
              </div>
            )}
            {weeksError && <p className="px-3 pt-1 text-[13px] text-destructive">{weeksError}</p>}
          </div>
        </DrawerContent>
      </Drawer>

      {/* 粘贴文字导入 + 识别预览（导入文件走同一预览） */}
      <Dialog
        open={pasteOpen}
        onOpenChange={(o) => {
          if (!o) {
            setPasteOpen(false);
            setParsed(null);
          }
        }}
      >
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
              <Button
                className="min-h-11 w-full"
                disabled={pasteText.trim().length === 0}
                onClick={doParse}
              >
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
              onImport={() => void doImport()}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* 恢复确认：覆盖预览 + 红字后果（§6.3 选文件 → 覆盖预览 → AlertDialog） */}
      <AlertDialog
        open={!!restorePreview}
        onOpenChange={(o) => {
          if (!o) setRestorePreview(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认恢复这份备份？</AlertDialogTitle>
            {restorePreview && (
              <AlertDialogDescription>
                导出于{" "}
                {new Date(restorePreview.preview.exportedAt).toLocaleString("zh-CN", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
                ，包含 {restorePreview.preview.courses} 门课 · {restorePreview.preview.slots} 个时段 ·{" "}
                {restorePreview.preview.photos} 张照片（星标 {restorePreview.preview.starred} 张）·
                约 {restorePreview.preview.sizeMB} MB。当前应用里有 {restorePreview.current.courses}{" "}
                门课 · {restorePreview.current.photos} 张照片。
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <p className="text-sm text-destructive">
            恢复会覆盖当前的全部课表、课程和照片，无法撤销。
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>先不恢复</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoring}
              onClick={() => void confirmRestore()}
            >
              {restoring ? "恢复中…" : "确认覆盖恢复"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
