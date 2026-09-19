import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Camera, ImagePlus, Pencil } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { EmptySketch } from "@/components/empty-sketch";
import { PhotoViewer } from "@/components/photo-viewer";
import { CourseEditorDialog } from "@/components/course-editor-dialog";
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

/** 课程相册：日期分组网格；courseId="pending" 为待分类；点图进沉浸查看器（可改派/备注/删除） */
function AlbumPage() {
  const { courseId } = Route.useParams();
  const router = useRouter();
  const [course, setCourse] = useState<Course | null>(null);
  const [allCourses, setAllCourses] = useState<Course[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  function handleToggleStar(p: Photo) {
    const next = { ...p, starred: !p.starred };
    void savePhoto(next).then(() => {
      setGroups((gs) =>
        gs.map((g) => ({
          ...g,
          photos: g.photos.map((x) => (x.id === p.id ? next : x)),
        })),
      );
      if (next.starred) toast.success("已标为重点板书");
    });
  }

  function handleUpdateNote(p: Photo, note: string) {
    const next = { ...p, note: note || undefined };
    void savePhoto(next).then(() => {
      setGroups((gs) =>
        gs.map((g) => ({
          ...g,
          photos: g.photos.map((x) => (x.id === p.id ? next : x)),
        })),
      );
      if (note) toast.success("备注已保存");
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

  return (
    <div className="mx-auto min-h-screen max-w-lg">
      <header className="mb-3 flex items-center gap-1 px-2 pt-4">
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
                去拍板书
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-6 px-4 pb-8">
          {groups.map((g) => (
            <section key={g.key}>
              <h2 className="mb-2 text-xs font-medium text-muted-foreground">{g.label}</h2>
              <div className="grid grid-cols-3 gap-1">
                {g.photos.map((p) => {
                  const pd = new Date(p.capturedAt);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setViewIdx(flatPhotos.findIndex((x) => x.id === p.id))}
                      aria-label={`查看${g.label} ${minToHHmm(pd.getHours() * 60 + pd.getMinutes())} 的照片`}
                      className="relative aspect-square overflow-hidden rounded-md bg-muted active:opacity-75"
                    >
                      {urls.get(p.id) && (
                        <img
                          src={urls.get(p.id)!}
                          alt=""
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      )}
                      <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1 text-[10px] leading-4 text-white">
                        {minToHHmm(pd.getHours() * 60 + pd.getMinutes())}
                      </span>
                      {p.note && (
                        <span className="absolute left-1 top-1 rounded-full bg-white/90 p-0.5 text-black">
                          <StickyNoteIcon />
                        </span>
                      )}
                      {p.starred && (
                        <span className="absolute bottom-1 left-1 size-2 rounded-full bg-yellow-300 ring-1 ring-black/20" />
                      )}
                    </button>
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
    </div>
  );
}

function StickyNoteIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <path d="M4 4h16v12l-4 4H4z" strokeLinejoin="round" />
      <path d="M16 20v-4h4" strokeLinejoin="round" />
    </svg>
  );
}
