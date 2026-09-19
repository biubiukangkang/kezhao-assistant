import { Link, createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/page-shell";
import { ChevronRight, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptySketch } from "@/components/empty-sketch";
import { Input } from "@/components/ui/input";
import { listCourses, listPhotos } from "@/lib/db";
import type { Course, Photo } from "@/lib/types";

export const Route = createFileRoute("/courses")({
  component: CoursesPage,
});

/** 课程库：一摞讲义。右侧露最近 3 张缩略图当内容预览，顶部搜索（W3 接 OCR 全文检索） */
function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void Promise.all([listCourses(), listPhotos()]).then(([c, p]) => {
      setCourses(c);
      setPhotos(p);
    });
  }, []);

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
        if (p.blob) m.set(p.id, URL.createObjectURL(p.blob));
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

  const q = query.trim().toLowerCase();
  const filtered = q ? courses.filter((c) => c.name.toLowerCase().includes(q)) : courses;
  const empty = courses.length === 0 && pendingCount === 0;

  return (
    <PageShell>
    <div className="px-4 pt-6">
      <header className="mb-3">
        <h1 className="text-xl font-semibold tracking-tight">课程库</h1>
      </header>

      {empty ? (
        <div className="flex flex-col items-center gap-2 pt-14 text-center">
          <EmptySketch className="w-40" />
          <p className="text-sm text-muted-foreground">还没有课程</p>
          <p className="text-xs text-muted-foreground">
            录上课表，拍的照片就会自动各回各家
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
                  <Link
                    to="/course-album/$courseId"
                    params={{ courseId: c.id }}
                    className="flex min-h-16 w-full items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm transition-colors hover:bg-accent/50 active:bg-accent"
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
                          className="size-9 rounded-md border-2 border-card bg-muted object-cover"
                        />
                      ))}
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="py-8 text-center text-sm text-muted-foreground">
                没有叫「{query.trim()}」的课程
              </li>
            )}
          </ul>
        </>
      )}
      </div>
    </PageShell>
  );
}
