import { useEffect, useState } from "react";
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
import { ChevronLeft, ChevronRight, FolderInput, Star, StickyNote, Trash2, X } from "lucide-react";
import { minToHHmm } from "@/lib/periods";
import { cn } from "@/lib/utils";
import type { Course, Photo } from "@/lib/types";

/** 全屏沉浸查看器（iOS 相册范式）：黑底、点图关闭、左右切换、星标、移动改派、备注、删除 */
export function PhotoViewer({
  photos,
  index,
  urls,
  courses,
  onIndexChange,
  onClose,
  onToggleStar,
  onDelete,
  onMoveTo,
  onUpdateNote,
}: {
  photos: Photo[];
  index: number;
  urls: Map<string, string>;
  courses: Course[];
  onIndexChange: (i: number) => void;
  onClose: () => void;
  onToggleStar: (p: Photo) => void;
  onDelete: (p: Photo) => void;
  onMoveTo: (p: Photo, courseId: string | null) => void;
  onUpdateNote: (p: Photo, note: string) => void;
}) {
  const photo = photos[index];
  const [moveOpen, setMoveOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      if (e.key === "ArrowRight" && index < photos.length - 1) onIndexChange(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, photos.length, onClose, onIndexChange]);

  if (!photo) return null;
  const d = new Date(photo.capturedAt);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-3 pt-4">
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="rounded-full p-2 active:bg-white/10"
        >
          <X className="size-5" />
        </button>
        <span className="text-xs text-white/70">
          {index + 1} / {photos.length} ·{" "}
          {`${d.getMonth() + 1}月${d.getDate()}日 ${minToHHmm(d.getHours() * 60 + d.getMinutes())}`}
        </span>
        <span className="size-9" />
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center" onClick={onClose}>
        {urls.get(photo.id) && (
          <img
            src={urls.get(photo.id)!}
            alt="板书照片"
            className="max-h-full max-w-full object-contain"
          />
        )}
        {index > 0 && (
          <button
            type="button"
            aria-label="上一张"
            onClick={(e) => {
              e.stopPropagation();
              onIndexChange(index - 1);
            }}
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 active:scale-90 active:bg-white/25"
          >
            <ChevronLeft className="size-5" />
          </button>
        )}
        {index < photos.length - 1 && (
          <button
            type="button"
            aria-label="下一张"
            onClick={(e) => {
              e.stopPropagation();
              onIndexChange(index + 1);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 active:scale-90 active:bg-white/25"
          >
            <ChevronRight className="size-5" />
          </button>
        )}
      </div>

      {photo.note && (
        <p className="px-8 pb-1 text-center text-xs leading-5 text-white/85">
          <StickyNote className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
          {photo.note}
        </p>
      )}

      <div className="flex items-center justify-around pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
        <button
          type="button"
          aria-label={photo.starred ? "取消星标" : "星标重点板书"}
          onClick={() => onToggleStar(photo)}
          className={cn(
            "rounded-full p-3 active:bg-white/10",
            photo.starred && "text-yellow-400",
          )}
        >
          <Star className={cn("size-5", photo.starred && "fill-current")} />
        </button>

        <AlertDialog open={moveOpen} onOpenChange={setMoveOpen}>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              aria-label="移动到其他课程"
              className="rounded-full p-3 active:bg-white/10"
            >
              <FolderInput className="size-5" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>移动到…</AlertDialogTitle>
              <AlertDialogDescription>选错了没关系，随时可以再改。</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {courses.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onMoveTo(photo, c.id);
                    setMoveOpen(false);
                  }}
                  className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 active:bg-muted"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: c.color }}
                  />
                  <span className="text-sm">{c.name}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  onMoveTo(photo, null);
                  setMoveOpen(false);
                }}
                className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 active:bg-muted"
              >
                <span className="size-2.5 shrink-0 rounded-full bg-amber-400" />
                <span className="text-sm">待分类</span>
              </button>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={noteOpen}
          onOpenChange={(o) => {
            setNoteOpen(o);
            if (o) setNoteDraft(photo.note ?? "");
          }}
        >
          <AlertDialogTrigger asChild>
            <button
              type="button"
              aria-label={photo.note ? "编辑备注" : "添加备注"}
              className={cn("rounded-full p-3 active:bg-white/10", photo.note && "text-yellow-400")}
            >
              <StickyNote className="size-5" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>给这张照片写点什么</AlertDialogTitle>
              <AlertDialogDescription>比如：这份作业周五交。会显示在照片下面。</AlertDialogDescription>
            </AlertDialogHeader>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={3}
              maxLength={200}
              placeholder="写点提醒…"
              className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="备注内容"
            />
            <AlertDialogFooter>
              {photo.note && (
                <AlertDialogAction
                  onClick={() => {
                    onUpdateNote(photo, "");
                    setNoteOpen(false);
                  }}
                  className="mr-auto border border-input bg-transparent text-destructive hover:bg-muted"
                >
                  清除备注
                </AlertDialogAction>
              )}
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  onUpdateNote(photo, noteDraft.trim());
                  setNoteOpen(false);
                }}
              >
                保存
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              aria-label="删除照片"
              className="rounded-full p-3 text-red-400 active:bg-white/10"
            >
              <Trash2 className="size-5" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除这张照片？</AlertDialogTitle>
              <AlertDialogDescription>删除后无法恢复。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>先不删</AlertDialogCancel>
              <AlertDialogAction onClick={() => onDelete(photo)}>删除</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
