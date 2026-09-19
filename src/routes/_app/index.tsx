import { Link, createFileRoute } from "@tanstack/react-router";
import { Camera, ImagePlus, Settings, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { EmptySketch } from "@/components/empty-sketch";
import { archiveFiles, type BatchResult } from "@/lib/archive";
import { getSettings, listCourses, listPhotos, listSlots, savePhoto } from "@/lib/db";
import { getSemesterWeek, slotsOnDate, weekdayOf } from "@/lib/match";
import { locateSlotPeriods, minToHHmm, periodLabel } from "@/lib/periods";
import {
  WEEKDAY_NAMES,
  type AppSettings,
  type Course,
  type Photo,
  type ScheduleSlot,
} from "@/lib/types";

export const Route = createFileRoute("/_app/")({
  component: HomePage,
});

function toastBatch(r: BatchResult) {
  const parts = [
    r.archived > 0 ? `归档 ${r.archived} 张` : "",
    r.pending > 0 ? `${r.pending} 张待分类` : "",
    r.duplicates > 0 ? `跳过重复 ${r.duplicates} 张` : "",
  ].filter(Boolean);
  if (parts.length === 0) {
    toast.error("没找到图片");
    return;
  }
  const text = parts.join(" · ");
  if (r.archived > 0) toast.success("导入完成", { description: text });
  else toast("导入完成", { description: text });
}

/** 首页：拍板书 C 位 + 今天 + 最近归档 + 成就。配置收进设置，广告词只出现在空状态 */
function HomePage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void Promise.all([getSettings(), listSlots(), listCourses(), listPhotos()]).then(
      ([s, sl, c, p]) => {
        setSettings(s);
        setSlots(sl);
        setCourses(c);
        setPhotos(p);
      },
    );
  }, []);

  const urls = useMemo(() => {
    const m = new Map<string, string>();
    const batchId = photos[0]?.batchId;
    const wanted = new Set<string>();
    for (const p of photos.slice(0, 8)) wanted.add(p.id);
    if (batchId) for (const p of photos) if (p.batchId === batchId) wanted.add(p.id);
    for (const p of photos) {
      if (wanted.has(p.id) && p.blob && !m.has(p.id)) {
        m.set(p.id, URL.createObjectURL(p.blob));
      }
    }
    return m;
  }, [photos]);
  useEffect(
    () => () => {
      for (const u of urls.values()) URL.revokeObjectURL(u);
    },
    [urls],
  );

  const now = Date.now();
  const d = new Date(now);
  const week = settings ? getSemesterWeek(now, settings.semesterStart) : null;
  const todaySlots = settings ? slotsOnDate(now, slots, settings) : [];
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const nowMin = d.getHours() * 60 + d.getMinutes();
  // 本次导入结果卡：最新 batch 一组；收起仅对本批生效，新导入自动重新出现
  const latestBatchId = photos[0]?.batchId;
  const latestBatch = latestBatchId ? photos.filter((p) => p.batchId === latestBatchId) : [];
  const [dismissedBatchId, setDismissedBatchId] = useState<string | null>(null);
  const [reassignPhoto, setReassignPhoto] = useState<Photo | null>(null);
  const periods = settings?.periods ?? [];
  const weeksCovered =
    settings && week !== null
      ? new Set(
          photos
            .map((p) => getSemesterWeek(p.capturedAt, settings.semesterStart))
            .filter((w): w is number => w !== null),
        ).size
      : 0;

  function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    void archiveFiles(files).then(toastBatch);
  }

  function handleReassign(p: Photo, targetId: string | null) {
    const target = targetId ? courses.find((c) => c.id === targetId) : null;
    const next = {
      ...p,
      courseId: targetId,
      matchMethod: (targetId ? "manual" : "unmatched") as Photo["matchMethod"],
    };
    void savePhoto(next).then(() => {
      setPhotos((prev) => prev.map((x) => (x.id === p.id ? next : x)));
      setReassignPhoto(null);
      toast.success(target ? `已移到「${target.name}」` : "已移到待分类");
    });
  }

  return (
    <div className="flex min-h-[calc(100vh-5rem)] flex-col px-4 pt-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">课照助手</h1>
          <p className="text-xs text-muted-foreground">
            {`${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAY_NAMES[weekdayOf(now) - 1]}`}
            {week !== null ? ` · 第 ${week} 周` : ""}
          </p>
        </div>
        <Link
          to="/settings"
          aria-label="设置"
          className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted active:bg-muted"
        >
          <Settings className="size-5" />
        </Link>
      </header>

      {latestBatch.length > 0 && dismissedBatchId !== latestBatchId && (
        <section className="mt-4 rounded-2xl border bg-card p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">本次导入 · {latestBatch.length} 张</h2>
            <button
              type="button"
              aria-label="收起"
              onClick={() => setDismissedBatchId(latestBatchId)}
              className="rounded-full p-1 text-muted-foreground active:bg-muted"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar">
            {latestBatch.map((p) => {
              const c = p.courseId ? courseById.get(p.courseId) : null;
              return (
                <div key={p.id} className="w-24 shrink-0">
                  <Link
                    to="/course-album/$courseId"
                    params={{ courseId: p.courseId ?? "pending" }}
                    className="block active:opacity-75"
                  >
                    <div className="aspect-square overflow-hidden rounded-lg bg-muted">
                      {urls.get(p.id) && (
                        <img
                          src={urls.get(p.id)!}
                          alt=""
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      )}
                    </div>
                  </Link>
                  <button
                    type="button"
                    onClick={() => setReassignPhoto(p)}
                    className="mt-1 flex min-h-6 w-full items-center justify-center gap-1 rounded-full border bg-muted/50 px-1 text-[10px] text-muted-foreground active:bg-muted"
                  >
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: c?.color ?? "#94a3b8" }}
                    />
                    <span className="truncate">{c?.name ?? "待分类"}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {week !== null && (
        <section className="mt-4 rounded-2xl border bg-card p-4 shadow-sm">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-medium">今天</h2>
            {todaySlots.length > 0 && (
              <span className="text-xs text-muted-foreground">{todaySlots.length} 节</span>
            )}
          </div>
          {todaySlots.length === 0 ? (
            <p className="py-2.5 text-center text-sm text-muted-foreground">今天没课</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {todaySlots.map((s) => {
                const c = courseById.get(s.courseId);
                const isNow = s.startMin <= nowMin && nowMin <= s.endMin;
                const located = locateSlotPeriods(s, periods);
                return (
                  <li key={s.id} className="flex items-center gap-3 py-2.5">
                    <span
                      className="h-9 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: c?.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{c?.name ?? "未知课程"}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {minToHHmm(s.startMin)}–{minToHHmm(s.endMin)}
                        {located !== null ? ` · ${periodLabel(located.start)} 节` : ""}
                        {` · 第 ${s.weekStart}-${s.weekEnd} 周`}
                      </div>
                    </div>
                    {isNow && (
                      <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        正在上
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {photos.length > 0 && (
        <section className="mt-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-medium">最近归档</h2>
            <Link to="/courses" className="text-xs text-muted-foreground active:opacity-70">
              全部
            </Link>
          </div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar">
            {photos.slice(0, 8).map((p) => {
              const c = p.courseId ? courseById.get(p.courseId) : null;
              const pd = new Date(p.capturedAt);
              return (
                <Link
                  key={p.id}
                  to="/course-album/$courseId"
                  params={{ courseId: p.courseId ?? "pending" }}
                  className="w-24 shrink-0 active:opacity-75"
                >
                  <div className="aspect-square overflow-hidden rounded-lg bg-muted">
                    {urls.get(p.id) && (
                      <img
                        src={urls.get(p.id)!}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    )}
                  </div>
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span
                      className="inline-block size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: c?.color ?? "#94a3b8" }}
                    />
                    {pd.getMonth() + 1}.{pd.getDate()}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {photos.length > 0 && (
        <section className="mt-4 rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-4">
            <span className="text-4xl font-bold tracking-tight">{photos.length}</span>
            <span className="text-xs leading-5 text-muted-foreground">
              本学期已归档 {photos.length} 张
              <br />
              覆盖 {courses.length} 门课
              {weeksCovered > 0 ? ` · 记录 ${weeksCovered} 周` : ""}
            </span>
          </div>
        </section>
      )}

      {photos.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
          <EmptySketch className="w-40" />
          <p className="text-sm leading-6 text-muted-foreground">
            拍完什么都不用管
            <br />
            复习时来课程库找，整整齐齐
          </p>
        </div>
      )}

      {photos.length > 0 && <div className="flex-1" />}

      <div className="space-y-3 pb-4 pt-4">
        <Link
          to="/camera"
          className="flex min-h-20 w-full items-center justify-center gap-3 rounded-3xl bg-primary text-lg font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:bg-primary/90 active:scale-[0.98] active:bg-primary/80"
        >
          <Camera className="size-7" />
          拍板书
        </Link>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border text-sm text-muted-foreground transition-colors hover:bg-accent active:bg-muted"
        >
          <ImagePlus className="size-4" />
          从相册导入
        </button>
      </div>

      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />

      <Drawer open={!!reassignPhoto} onOpenChange={(o) => !o && setReassignPhoto(null)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>移动到…</DrawerTitle>
          </DrawerHeader>
          <div className="max-h-72 space-y-1 overflow-y-auto px-4 pb-8">
            {courses.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => reassignPhoto && handleReassign(reassignPhoto, c.id)}
                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 active:bg-muted"
              >
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: c.color }}
                />
                <span className="text-sm">{c.name}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => reassignPhoto && handleReassign(reassignPhoto, null)}
              className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 active:bg-muted"
            >
              <span className="size-3 shrink-0 rounded-full bg-amber-400" />
              <span className="text-sm">待分类</span>
            </button>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
