import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Camera, Check, ImagePlus, Pencil, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
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
import { addPhotosToCourse, type BatchResult } from "@/lib/archive";
import { deletePhoto, listCourses, listPhotos, savePhoto } from "@/lib/db";
import { weekdayOf } from "@/lib/match";
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
    });
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const flatPhotos = useMemo(() => groups.flatMap((g) => g.photos), [groups]);
  const urls = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of flatPhotos) {
      if (p.blob) m.set(p.id, URL.createObjectURL(p.blob));
    }
    return m;
  }, [flatPhotos]);
  useEffect(
    () => () => {
      for (const u of urls.values()) URL.revokeObjectURL(u);
    },
    [urls],
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
    void deletePhoto(p.id).then(() => {
      setViewIdx(nextIdx);
      load();
      toast("已删除");
    });
  }

  function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    void addPhotosToCourse(files, isPending ? null : courseId).then((r) => {
      toastBatch(r);
      load();
    });
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
    <div className="mx-auto min-h-screen max-w-lg">
      <header className="sticky top-0 z-30 mb-3 flex items-center gap-1 border-b bg-background/95 px-2 py-2.5 pt-4 backdrop-blur">
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
          aria-label="添加照片"
          onClick={() => fileRef.current?.click()}
          className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted active:bg-muted"
        >
          <ImagePlus className="size-5" />
        </button>
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
                {urls.get(p.id) && (
                  <img
                    src={urls.get(p.id)!}
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
          {groups.map((g) => (
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
                          <span className="flex items-center gap-0.5 font-medium text-yellow-600">
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
                        {urls.get(p.id) && (
                          <img
                            src={urls.get(p.id)!}
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
        </div>
      )}

      {viewIdx !== null && flatPhotos.length > 0 && (
        <PhotoViewer
          photos={flatPhotos}
          index={Math.min(viewIdx, flatPhotos.length - 1)}
          urls={urls}
          courses={allCourses}
          onIndexChange={setViewIdx}
          onClose={() => setViewIdx(null)}
          onToggleStar={handleToggleStar}
          onDelete={handleDelete}
          onMoveTo={handleMoveTo}
          onUpdateNote={handleUpdateNote}
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
