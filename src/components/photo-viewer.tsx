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
import { ChevronLeft, ChevronRight, Clock, FolderInput, Share2, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { exportPhotos } from "@/lib/photo-export";
import { minToHHmm } from "@/lib/periods";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { Course, Photo } from "@/lib/types";

function toLocalInput(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 全屏沉浸查看器（iOS 相册范式）：黑底、点图关闭、左右切换、星标、移动改派、改时间、备注、删除 */
export function PhotoViewer({
  photos,
  index,
  urlFor,
  courses,
  onIndexChange,
  onClose,
  onToggleStar,
  onDelete,
  onMoveTo,
  onUpdateNote,
  onUpdateCaptureAt,
}: {
  photos: Photo[];
  index: number;
  urlFor: (p: Photo) => string | undefined;
  courses: Course[];
  onIndexChange: (i: number) => void;
  onClose: () => void;
  onToggleStar: (p: Photo) => void;
  onDelete: (p: Photo) => void;
  onMoveTo: (p: Photo, courseId: string | null) => void;
  onUpdateNote: (p: Photo, note: string) => void;
  onUpdateCaptureAt: (p: Photo, t: number) => void;
}) {
  const photo = photos[index];
  const [moveOpen, setMoveOpen] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [timeDraft, setTimeDraft] = useState("");
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      const r = await exportPhotos([photo]);
      if (r === "saved") toast.success("已存入系统相册「课照助手」");
      else if (r === "shared") toast.success("已调起系统分享，可选保存到相册");
      else if (r === "downloaded") toast.success("已开始下载");
      else toast.error("这张照片的数据是空的");
    } catch {
      toast.error("导出失败，重试一次");
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
      if (e.key === "ArrowRight" && index < photos.length - 1) onIndexChange(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, photos.length, onClose, onIndexChange]);

  // 切换照片时退出编辑态，避免上一张的编辑框串到下一张
  useEffect(() => {
    setEditingNote(false);
  }, [photo?.id]);

  if (!photo) return null;
  const d = new Date(photo.capturedAt);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-3 pt-[max(1rem,env(safe-area-inset-top))]">
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
        {urlFor(photo) && (
          <img
            src={urlFor(photo)!}
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

      {/* 备忘录备注：无备注=淡字入口；编辑中/有备注=常驻文本框，失焦自动保存（删光即清除） */}
      {editingNote || photo.note ? (
        <textarea
          key={photo.id}
          defaultValue={photo.note ?? ""}
          autoFocus={editingNote}
          rows={2}
          maxLength={200}
          placeholder="写点提醒，比如：这份作业周五交…"
          aria-label="备注内容"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== (photo.note ?? "")) onUpdateNote(photo, v);
            setEditingNote(false);
          }}
          className="mx-6 mb-1 w-[calc(100%-3rem)] resize-none rounded-xl bg-white/10 px-3 py-2.5 text-sm leading-5 text-white placeholder:text-white/40 focus:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditingNote(true)}
          className="mb-1 px-6 text-xs text-white/40 transition-colors active:text-white/70"
        >
          ＋ 写提醒…
        </button>
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

        <button
          type="button"
          aria-label="保存或分享照片"
          disabled={exporting}
          onClick={() => void handleExport()}
          className="rounded-full p-3 active:bg-white/10 disabled:opacity-50"
        >
          <Share2 className="size-5" />
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
          open={timeOpen}
          onOpenChange={(o) => {
            setTimeOpen(o);
            if (o) setTimeDraft(toLocalInput(photo.capturedAt));
          }}
        >
          <AlertDialogTrigger asChild>
            <button
              type="button"
              aria-label="修改拍摄时间"
              className="rounded-full p-3 active:bg-white/10"
            >
              <Clock className="size-5" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>修改拍摄时间</AlertDialogTitle>
              <AlertDialogDescription>
                手机时间不准导致归错课的时候用。改完会按新时间重新归到对应课程。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              type="datetime-local"
              value={timeDraft}
              onChange={(e) => setTimeDraft(e.target.value)}
              className="min-h-11"
              aria-label="拍摄时间"
            />
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const t = new Date(timeDraft).getTime();
                  if (!Number.isNaN(t)) onUpdateCaptureAt(photo, t);
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
              <AlertDialogDescription>
                照片会先进回收站，30 天内可以在「设置 → 回收站」恢复。
              </AlertDialogDescription>
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
