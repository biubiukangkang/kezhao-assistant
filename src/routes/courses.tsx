import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageShell } from "@/components/page-shell";
import { ChevronRight, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptySketch } from "@/components/empty-sketch";
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
} from "@/components/ui/alert-dialog";
import { CourseEditorDialog } from "@/components/course-editor-dialog";
import { COURSE_COLORS } from "@/lib/types";
import { deleteCourse, listCourses, listPhotos } from "@/lib/db";
import type { Course, Photo } from "@/lib/types";

export const Route = createFileRoute("/courses")({
  component: CoursesPage,
});

type MenuPos = { left: number; top: number; below: boolean };

/** 课程库：一摞讲义。长按课程卡（桌面右键）从卡片下方弹出编辑/删除；顶部搜索（W3 接 OCR 全文检索） */
function CoursesPage() {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Course | null>(null);
  const [deleting, setDeleting] = useState<Course | null>(null);
  const [actionTarget, setActionTarget] = useState<Course | null>(null);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const pressTimer = useRef<number | undefined>(undefined);
  const pressEl = useRef<HTMLElement | null>(null);
  const longPressed = useRef(false);

  const load = () => {
    void Promise.all([listCourses(), listPhotos()]).then(([c, p]) => {
      setCourses(c);
      setPhotos(p);
    });
  };
  useEffect(load, []);

  const countByCourse = new Map<string, number>();
  let pendingCount = 0;
  for (const p of photos) {
    if (p.courseId) {
      countByCourse.set(p.courseId, (countByCourse.get(p.courseId) ?? 0) + 1);
    } else {
      pendingCount += 1;
    }
  }

  const previewByCourse = useMemo(() => {
    const m = new Map<string, Photo[]>();
    for (const p of photos) {
      if (!p.courseId) continue;
      const arr = m.get(p.courseId) ?? [];
      if (arr.length < 3) arr.push(p);
      m.set(p.courseId, arr);
    }
    return m;
  }, [photos]);

  const urls = useMemo(() => {
    const m = new Map<string, string>();
    for (const arr of previewByCourse.values()) {
      for (const p of arr) {
        const src = (p.thumb ?? p.blob) as Blob | undefined;
        if (src) m.set(p.id, URL.createObjectURL(src));
      }
    }
    return m;
  }, [previewByCourse]);
  useEffect(
    () => () => {
      for (const u of urls.values()) URL.revokeObjectURL(u);
    },
    [urls],
  );

  function openActions(c: Course, el: HTMLElement) {
    if ("vibrate" in navigator) navigator.vibrate(10);
    longPressed.current = true;
    const rect = el.getBoundingClientRect();
    const below = rect.bottom + 130 < window.innerHeight; // 菜单高约 110，放得下就朝下弹
    setMenuPos({ left: rect.left, top: rect.bottom, below });
    setActionTarget(c);
  }
  function startPress(c: Course, el: HTMLElement) {
    pressEl.current = el;
    window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      if (pressEl.current) openActions(c, pressEl.current);
    }, 500);
  }
  function clearPress() {
    window.clearTimeout(pressTimer.current);
  }
  function openAlbum(c: Course) {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    void navigate({ to: "/course-album/$courseId", params: { courseId: c.id } });
  }

  async function handleDelete() {
    if (!deleting) return;
    await deleteCourse(deleting.id);
    toast.success(`已删除「${deleting.name}」`);
    setDeleting(null);
    load();
  }

  const q = query.trim().toLowerCase();
  const filtered = q ? courses.filter((c) => c.name.toLowerCase().includes(q)) : courses;
  const empty = courses.length === 0 && pendingCount === 0;

  return (
    <PageShell>
      <div className="px-4 pt-6">
        <header className="mb-3 flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">课程库</h1>
          <button
            type="button"
            aria-label="添加课程"
            onClick={() => setAdding(true)}
            className="flex size-9 items-center justify-center rounded-full border bg-card text-foreground shadow-sm active:bg-muted"
          >
            <Plus className="size-5" />
          </button>
        </header>

        {empty ? (
          <div className="flex flex-col items-center gap-2 pt-14 text-center">
            <EmptySketch className="w-40" />
            <p className="text-sm text-muted-foreground">还没有课程</p>
            <p className="text-xs text-muted-foreground">
              录上课表或点右上角加号，拍的照片就会自动各回各家
            </p>
            <Link
              to="/schedule"
              className="mt-2 inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground active:scale-[0.98]"
            >
              去录入课表
            </Link>
          </div>
        ) : (
          <>
            <div className="relative mb-3">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索课程"
                className="min-h-11 rounded-xl pl-9"
                aria-label="搜索课程"
              />
            </div>

            <ul className="space-y-2 pb-4">
              {pendingCount > 0 && (
                <li>
                  <Link
                    to="/course-album/$courseId"
                    params={{ courseId: "pending" }}
                    className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-dashed bg-card p-4 shadow-sm transition-colors hover:bg-accent/50 active:bg-accent"
                  >
                    <span className="size-3 shrink-0 rounded-full bg-amber-400" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">待分类</div>
                      <div className="text-xs text-muted-foreground">
                        {pendingCount} 张 · 还没认出是哪节课的
                      </div>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              )}
              {filtered.map((c) => {
                const previews = previewByCourse.get(c.id) ?? [];
                return (
                  <li key={c.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`课程 ${c.name}，长按管理`}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        openActions(c, e.currentTarget);
                      }}
                      onTouchStart={(e) => startPress(c, e.currentTarget)}
                      onTouchEnd={clearPress}
                      onTouchMove={clearPress}
                      onMouseDown={(e) => startPress(c, e.currentTarget)}
                      onMouseUp={clearPress}
                      onMouseLeave={clearPress}
                      onClick={() => openAlbum(c)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") openAlbum(c);
                      }}
                      className="flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm transition-colors select-none hover:bg-accent/50 active:bg-accent"
                    >
                      <span
                        className="size-3 shrink-0 rounded-full"
                        style={{ backgroundColor: c.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {(countByCourse.get(c.id) ?? 0) > 0
                            ? `${countByCourse.get(c.id)} 张`
                            : "还没有照片"}
                        </div>
                      </div>
                      <div className="flex -space-x-2.5">
                        {previews.map((p) => (
                          <img
                            key={p.id}
                            src={urls.get(p.id)}
                            alt=""
                            loading="lazy"
                            draggable={false}
                            className="size-9 rounded-md border-2 border-card bg-muted object-cover pointer-events-none"
                          />
                        ))}
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </div>
                  </li>
                );
              })}
              {filtered.length === 0 && (
                <li className="py-8 text-center text-sm text-muted-foreground">
                  没有叫「{query.trim()}」的课程
                </li>
              )}
            </ul>
            <p className="-mt-2 pb-3 text-center text-xs text-muted-foreground/70">
              长按课程可以改名或删除
            </p>
          </>
        )}
      </div>

      {actionTarget && menuPos && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setActionTarget(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setActionTarget(null);
            }}
          />
          <div
            className="fixed z-50 w-56 origin-top rounded-xl border bg-card p-1 shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
            style={{
              left: Math.min(menuPos.left, window.innerWidth - 224 - 12),
              ...(menuPos.below
                ? { top: menuPos.top + 6 }
                : { bottom: window.innerHeight - menuPos.top + 6 }),
            }}
          >
            <div className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">
              {actionTarget.name}
            </div>
            <button
              type="button"
              onClick={() => {
                setEditing(actionTarget);
                setActionTarget(null);
              }}
              className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-sm active:bg-muted"
            >
              <Pencil className="size-4 text-muted-foreground" />
              编辑课程
            </button>
            <button
              type="button"
              onClick={() => {
                setDeleting(actionTarget);
                setActionTarget(null);
              }}
              className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-sm text-destructive active:bg-muted"
            >
              <Trash2 className="size-4" />
              删除课程
            </button>
          </div>
        </>
      )}

      {editing && (
        <CourseEditorDialog
          course={editing}
          photoCount={countByCourse.get(editing.id) ?? 0}
          onSaved={() => {
            setEditing(null);
            load();
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {adding && (
        <CourseEditorDialog
          course={null}
          defaultColor={COURSE_COLORS[courses.length % COURSE_COLORS.length]}
          onSaved={() => {
            setAdding(false);
            load();
          }}
          onClose={() => setAdding(false)}
        />
      )}

      {deleting && (
        <AlertDialog open onOpenChange={(o) => !o && setDeleting(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除课程「{deleting.name}」？</AlertDialogTitle>
              <AlertDialogDescription>
                {(countByCourse.get(deleting.id) ?? 0) > 0
                  ? `它和对应的上课时段会被删除；已归档的 ${countByCourse.get(deleting.id)} 张照片会回到「待分类」，不会丢失。`
                  : "它和对应的上课时段会被删除，此操作无法撤销。"}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>先不删</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>删除</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </PageShell>
  );
}
