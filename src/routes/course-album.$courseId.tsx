import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Camera, Check, Download, ImagePlus, Pencil, RefreshCw, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { EmptySketch } from "@/components/empty-sketch";
import { PhotoViewer } from "@/components/photo-viewer";
import { CourseEditorDialog } from "@/components/course-editor-dialog";
import { Toaster } from "@/components/ui/sonner";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { addPhotosToCourse, makeThumb, rematchPhotos, type BatchResult } from "@/lib/archive";
import { deletePhoto, getSettings, listCourses, listPhotos, listSlots, savePhoto, savePhotos, softDeletePhoto } from "@/lib/db";
import { exportPhotos } from "@/lib/photo-export";
import { matchPhoto, weekdayOf } from "@/lib/match";
import { minToHHmm } from "@/lib/periods";
import { WEEKDAY_NAMES, type Course, type Photo } from "@/lib/types";

export const Route = createFileRoute("/course-album/$courseId")({
  component: AlbumPage,
});

type Group = { key: string; label: string; photos: Photo[] };

function toastBatch(r: BatchResult) {
  const parts = [
    r.archived > 0 ? `加入 ${r.archived} 张` : "",
    r.pending > 0 ? `${r.pending} 张待分类` : "",
    r.duplicates > 0 ? `跳过重复 ${r.duplicates} 张` : "",
  ].filter(Boolean);
  if (parts.length === 0) {
    toast.error("没找到图片");
    return;
  }
  const text = parts.join(" · ");
  if (r.archived > 0) toast.success("添加完成", { description: text });
  else toast("添加完成", { description: text });
}

/** 备注块（QQ 空间式）：文字醒目常显，点击原地编辑，失焦自动保存，删光即清除 */
function NoteBlock({
  photo,
  onSave,
}: {
  photo: Photo;
  onSave: (p: Photo, note: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing || photo.note) {
    return (
      <textarea
        key={photo.id}
        defaultValue={photo.note ?? ""}
        autoFocus={editing}
        rows={2}
        maxLength={200}
        placeholder="写点提醒，比如：这份作业周五交…"
        aria-label="备注内容"
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v !== (photo.note ?? "")) onSave(photo, v);
          setEditing(false);
        }}
        className="w-full resize-none rounded-lg bg-muted/40 px-2.5 py-1.5 text-[17px] leading-6 text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="text-xs text-muted-foreground transition-colors active:text-foreground"
    >
      ＋ 写提醒…
    </button>
  );
}

/** 课程相册：QQ 空间式动态流——上面文字（时间+备注）下面图片；courseId="pending" 为待分类 */
function AlbumPage() {
  const { courseId } = Route.useParams();
  const router = useRouter();
  const [course, setCourse] = useState<Course | null>(null);
  const [allCourses, setAllCourses] = useState<Course[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [visibleGroups, setVisibleGroups] = useState(3);
  const fileRef = useRef<HTMLInputElement>(null);
  // 待分类专属：多选批量移动
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);

  const isPending = courseId === "pending";

  const load = () => {
    void Promise.all([listCourses(), listPhotos()]).then(([cs, ps]) => {
      setAllCourses(cs);
      setCourse(cs.find((c) => c.id === courseId) ?? null);
      const byKey = new Map<string, Group>();
      const list: Group[] = [];
      for (const p of ps) {
        if (isPending ? p.courseId !== null : p.courseId !== courseId) continue;
        const d = new Date(p.capturedAt);
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        let g = byKey.get(key);
        if (!g) {
          g = {
            key,
            label: `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAY_NAMES[weekdayOf(p.capturedAt) - 1]}`,
            photos: [],
          };
          byKey.set(key, g);
          list.push(g);
        }
        g.photos.push(p);
      }
      setGroups(list);
      setVisibleGroups(3);
      backfillThumbs(list.flatMap((g) => g.photos));
    });
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const flatPhotos = useMemo(() => groups.flatMap((g) => g.photos), [groups]);

  // objectURL 按 id + 图像身份缓存：星标/备注/缩略图回填等局部更新不重建全表 URL，列表图片不再整页闪烁。
  // 列表（缩略图优先）与查看器（原图）各用独立缓存，避免互相顶掉对方的 URL
  const thumbCache = useRef(new Map<string, { url: string; src: Blob }>());
  const fullCache = useRef(new Map<string, { url: string; src: Blob }>());
  const cachedUrl = (cache: React.RefObject<Map<string, { url: string; src: Blob }>>, p: Photo, src: Blob | undefined): string | undefined => {
    if (!src) return undefined;
    const hit = cache.current.get(p.id);
    if (hit && hit.src === src) return hit.url;
    if (hit) URL.revokeObjectURL(hit.url);
    const url = URL.createObjectURL(src);
    cache.current.set(p.id, { url, src });
    return url;
  };
  const urlFor = useCallback(
    (p: Photo) => cachedUrl(thumbCache, p, (p.thumb ?? p.blob) as Blob | undefined),
    [],
  );
  const urlForFull = useCallback((p: Photo) => cachedUrl(fullCache, p, p.blob), []);
  useEffect(
    () => () => {
      for (const { url } of thumbCache.current.values()) URL.revokeObjectURL(url);
      for (const { url } of fullCache.current.values()) URL.revokeObjectURL(url);
    },
    [],
  );

  const total = flatPhotos.length;
  const movableCourses = allCourses.filter((c) => c.id !== courseId);

  function patchLocal(p: Photo) {
    setGroups((gs) =>
      gs.map((g) => ({
        ...g,
        photos: g.photos.map((x) => (x.id === p.id ? p : x)),
      })),
    );
  }

  // 旧数据没有缩略图的分批后台回填（每批 4 张、批间让出主线程），完成后列表自动切到小图
  const backfilling = useRef(false);
  function backfillThumbs(list: Photo[]) {
    if (backfilling.current) return;
    const need = list.filter((p) => p.blob && !p.thumb);
    if (need.length === 0) return;
    backfilling.current = true;
    void (async () => {
      try {
        const BATCH = 4;
        for (let i = 0; i < need.length; i += BATCH) {
          const batch = need.slice(i, i + BATCH);
          const updated: Photo[] = [];
          for (const p of batch) {
            const thumb = await makeThumb(p.blob!);
            if (thumb) updated.push({ ...p, thumb });
          }
          if (updated.length > 0) {
            await savePhotos(updated);
            for (const u of updated) patchLocal(u);
          }
          await new Promise((r) => setTimeout(r, 0));
        }
      } finally {
        backfilling.current = false;
      }
    })();
  }

  function handleToggleStar(p: Photo) {
    const next = { ...p, starred: !p.starred };
    void savePhoto(next).then(() => {
      patchLocal(next);
      if (next.starred) toast.success("已标为重点板书");
    });
  }

  function handleUpdateNote(p: Photo, note: string) {
    const next = { ...p, note: note || undefined };
    void savePhoto(next).then(() => {
      patchLocal(next);
      if (note) toast.success("提醒已保存");
    });
  }

  function handleMoveTo(p: Photo, targetId: string | null) {
    const target = targetId ? allCourses.find((c) => c.id === targetId) : null;
    void savePhoto({
      ...p,
      courseId: targetId,
      matchMethod: targetId ? "manual" : "unmatched",
    }).then(() => {
      toast.success(target ? `已移动到「${target.name}」` : "已移到待分类");
      setViewIdx(null);
      load();
    });
  }

  function handleDelete(p: Photo) {
    const nextIdx = flatPhotos.length > 1 ? Math.min(viewIdx ?? 0, flatPhotos.length - 2) : null;
    void softDeletePhoto(p.id).then(() => {
      setViewIdx(nextIdx);
      load();
      toast("已移入回收站", { description: "30 天内可在「设置 → 回收站」恢复" });
    });
  }

  const [exportingAll, setExportingAll] = useState(false);
  async function handleExportAll() {
    if (exportingAll || flatPhotos.length === 0) return;
    setExportingAll(true);
    try {
      const r = await exportPhotos(flatPhotos);
      if (r === "saved") toast.success(`已存入系统相册 ${flatPhotos.length} 张`, { description: "系统相册「课照助手」里可见" });
      else if (r === "shared") toast.success(`已调起系统分享（${flatPhotos.length} 张），可选保存到相册`);
      else if (r === "downloaded")
        toast.success(`已开始逐张下载 ${flatPhotos.length} 张`, {
          description: "浏览器若询问是否允许多文件下载，请选允许",
        });
      else toast.error("照片数据是空的");
    } catch {
      toast.error("导出失败，重试一次");
    } finally {
      setExportingAll(false);
    }
  }

  function handleUpdateTime(p: Photo, t: number) {
    // 改拍摄时间的动机就是"时间不准归错了课"：按新时间真正重新匹配课表，兑现文案承诺
    void (async () => {
      const [settings, slots] = await Promise.all([getSettings(), listSlots()]);
      const slot = matchPhoto(t, slots, settings);
      await savePhoto({
        ...p,
        capturedAt: t,
        capturedSource: "manual",
        courseId: slot?.courseId ?? null,
        matchMethod: slot ? "auto" : "unmatched",
      });
      setViewIdx(null);
      load();
      toast.success("时间已更新", {
        description: slot ? "已按新时间重新归档" : "新时间没匹配到课，已移入待分类",
      });
    })();
  }

  // 待分类页一键补救：课表录晚了 / 学期锚点改对了之后，全库自动照片按当前课表重算
  const [rematching, setRematching] = useState(false);
  async function handleRematch() {
    setRematching(true);
    try {
      const r = await rematchPhotos();
      if (r.moved > 0) {
        toast.success(`重新归档 ${r.moved} 张`, { description: "手动指定过的照片没有动" });
        load();
      } else {
        toast("没有需要调整的照片", {
          description: "当前课表下自动归档的照片都已就位",
        });
      }
    } finally {
      setRematching(false);
    }
  }

  function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setImportProgress({ done: 0, total: files.length });
    void addPhotosToCourse(files, isPending ? null : courseId, (done, total) =>
      setImportProgress({ done, total }),
    )
      .then((r) => {
        toastBatch(r);
        load();
      })
      .finally(() => setImportProgress(null));
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }

  async function handleBatchMove(targetId: string) {
    const targets = flatPhotos.filter((p) => selected.has(p.id));
    if (targets.length === 0) return;
    const target = allCourses.find((c) => c.id === targetId);
    for (const p of targets) {
      await savePhoto({ ...p, courseId: targetId, matchMethod: "manual" });
    }
    toast.success(`已把 ${targets.length} 张移到「${target?.name ?? "课程"}」`);
    setMoveOpen(false);
    exitSelect();
    load();
  }

  return (
    <div className="mx-auto flex h-dvh max-w-lg flex-col">
      <header className="z-30 mb-3 flex shrink-0 items-center gap-1 border-b bg-background/95 px-2 py-2.5 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <button
          type="button"
          aria-label="返回"
          onClick={() => router.history.back()}
          className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted active:bg-muted"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {isPending ? "待分类" : (course?.name ?? "课程相册")}
          </h1>
          <p className="text-xs text-muted-foreground">
            {total} 张照片
            {!isPending && course?.teacher ? ` · ${course.teacher}` : ""}
          </p>
        </div>
        <button
          type="button"
          aria-label={exportingAll ? "导出中" : "保存或分享本课程全部照片"}
          disabled={exportingAll || total === 0}
          onClick={() => void handleExportAll()}
          className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted active:bg-muted disabled:opacity-50"
        >
          <Download className="size-5" />
        </button>
        <button
          type="button"
          aria-label="添加照片"
          onClick={() => fileRef.current?.click()}
          className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted active:bg-muted"
        >
          <ImagePlus className="size-5" />
        </button>
        {isPending && (
          <button
            type="button"
            disabled={rematching}
            onClick={() => void handleRematch()}
            className="flex min-h-9 items-center gap-1 rounded-full px-2.5 text-xs text-muted-foreground transition-colors active:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${rematching ? "animate-spin" : ""}`} />
            {rematching ? "匹配中" : "重新匹配"}
          </button>
        )}
        {isPending && total > 0 && (
          <button
            type="button"
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            className={cn(
              "min-h-9 rounded-full px-3 text-sm transition-colors active:bg-muted",
              selectMode ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground",
            )}
          >
            {selectMode ? "取消" : "选择"}
          </button>
        )}
        {!isPending && course && (
          <button
            type="button"
            aria-label="编辑课程"
            onClick={() => setEditing(true)}
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted active:bg-muted"
          >
            <Pencil className="size-4" />
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
      {importProgress && (
        <p className="mb-3 px-4 text-xs text-muted-foreground">
          添加中 {importProgress.done}/{importProgress.total}…
        </p>
      )}

      {total === 0 ? (
        <div className="flex flex-col items-center gap-2 pt-16 text-center">
          <EmptySketch className="w-36" />
          <p className="text-sm text-muted-foreground">
            {isPending ? "没有待分类的照片" : "这学期还没拍过"}
          </p>
          {!isPending && (
            <>
              <p className="text-xs text-muted-foreground">
                上课拍的会自动到这里；相册里的旧图点右上角添加
              </p>
              <Link
                to="/camera"
                className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground active:scale-[0.98]"
              >
                <Camera className="size-4" />
                去拍照
              </Link>
            </>
          )}
        </div>
      ) : selectMode ? (
        <div className="grid grid-cols-3 gap-1.5 px-4 pb-32">
          {flatPhotos.map((p) => {
            const on = selected.has(p.id);
            const pd = new Date(p.capturedAt);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggleSelect(p.id)}
                aria-label={`选择 ${pd.getMonth() + 1}月${pd.getDate()}日 ${minToHHmm(pd.getHours() * 60 + pd.getMinutes())} 的照片`}
                className={cn(
                  "relative aspect-square overflow-hidden rounded-lg border-2 bg-muted transition-colors",
                  on ? "border-primary" : "border-transparent",
                )}
              >
                {urlFor(p) && (
                  <img
                    src={urlFor(p)!}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                  />
                )}
                <span
                  className={cn(
                    "absolute left-1 top-1 flex size-5 items-center justify-center rounded-full border-2 bg-white/85",
                    on && "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {on && <Check className="size-3" />}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-6 px-4 pb-8">
          {groups.slice(0, visibleGroups).map((g) => (
            <section key={g.key}>
              <h2 className="mb-2 text-xs font-medium text-muted-foreground">{g.label}</h2>
              <div className="space-y-3">
                {g.photos.map((p) => {
                  const pd = new Date(p.capturedAt);
                  return (
                    <div
                      key={p.id}
                      className="rounded-2xl border bg-card p-3 shadow-sm"
                    >
                      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{minToHHmm(pd.getHours() * 60 + pd.getMinutes())}</span>
                        {p.starred && (
                          <span className="flex items-center gap-0.5 font-medium text-yellow-600 dark:text-yellow-400">
                            <Star className="size-3 fill-current" aria-hidden />
                            重点
                          </span>
                        )}
                      </div>
                      <NoteBlock photo={p} onSave={handleUpdateNote} />
                      <button
                        type="button"
                        onClick={() => setViewIdx(flatPhotos.findIndex((x) => x.id === p.id))}
                        aria-label={`放大查看 ${minToHHmm(pd.getHours() * 60 + pd.getMinutes())} 的板书`}
                        className="mx-auto mt-2 block w-fit max-w-full overflow-hidden rounded-xl bg-muted active:opacity-90"
                      >
                    {urlFor(p) && (
                      <img
                        src={urlFor(p)!}
                        alt=""
                        loading="lazy"
                        className="max-h-72 w-auto max-w-full object-cover"
                      />
                    )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {groups.length > visibleGroups && (
            <button
              type="button"
              onClick={() => setVisibleGroups((n) => n + 3)}
              className="min-h-11 w-full rounded-xl border text-sm text-muted-foreground transition-colors active:bg-muted"
            >
              加载更早的照片（还有{" "}
              {groups.length - visibleGroups} 天）
            </button>
          )}
        </div>
      )}

      </div>

      {viewIdx !== null && flatPhotos.length > 0 && (
        <PhotoViewer
          photos={flatPhotos}
          index={Math.min(viewIdx, flatPhotos.length - 1)}
          urlFor={urlForFull}
          courses={allCourses}
          onIndexChange={setViewIdx}
          onClose={() => setViewIdx(null)}
          onToggleStar={handleToggleStar}
          onDelete={handleDelete}
          onMoveTo={handleMoveTo}
          onUpdateNote={handleUpdateNote}
          onUpdateCaptureAt={handleUpdateTime}
        />
      )}

      {editing && course && (
        <CourseEditorDialog
          course={course}
          photoCount={total}
          onSaved={() => {
            setEditing(false);
            load();
          }}
          onClose={() => setEditing(false)}
        />
      )}

      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />

      {selectMode && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <div className="mx-auto flex max-w-lg items-center gap-2 px-4">
            <button
              type="button"
              onClick={() => setSelected(new Set(flatPhotos.map((p) => p.id)))}
              className="min-h-11 rounded-lg px-3 text-sm text-muted-foreground active:bg-muted"
            >
              全选
            </button>
            <span className="text-sm text-muted-foreground">已选 {selected.size} 张</span>
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => setMoveOpen(true)}
              className="ml-auto flex min-h-11 flex-1 items-center justify-center rounded-xl bg-primary font-medium text-primary-foreground transition-colors active:scale-[0.98] disabled:opacity-50"
            >
              移动到…（{selected.size}）
            </button>
          </div>
        </div>
      )}

      <Drawer open={moveOpen} onOpenChange={(o) => !o && setMoveOpen(false)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>把 {selected.size} 张移到…</DrawerTitle>
          </DrawerHeader>
          <div className="max-h-72 space-y-1 overflow-y-auto px-4 pb-8">
            {allCourses.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => void handleBatchMove(c.id)}
                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 active:bg-muted"
              >
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: c.color }}
                />
                <span className="text-sm">{c.name}</span>
              </button>
            ))}
          </div>
        </DrawerContent>
      </Drawer>

      <Toaster />
    </div>
  );
}
