import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ImagePlus, SwitchCamera, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { archivePhoto, archiveFiles, type BatchResult } from "@/lib/archive";
import { uid } from "@/lib/db";

export const Route = createFileRoute("/camera")({
  component: CameraPage,
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

/** 全屏相机：拍完自动归档，缩略图角标反馈（不打断取景），toast 只留给异常 */
function CameraPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [lastShot, setLastShot] = useState<{ url: string; ok: boolean } | null>(null);
  const [shotCount, setShotCount] = useState(0);
  const [shotNote, setShotNote] = useState("");
  const noteTimer = useRef<number | undefined>(undefined);
  const lastDeviceId = useRef<string | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const router = useRouter();
  // 一次打开相机 = 一批，首页「本次导入」按批整组展示
  const [sessionBatchId] = useState(() => uid());

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) {
      setError("当前环境不支持相机。可以先从相册选照片，效果一样。");
      return;
    }
    const timer = window.setTimeout(() => {
      if (!cancelled && !stream) setError("相机暂时打不开（可能没授权）。可以先从相册选照片。");
    }, 8000);
    // 先用精确约束强制换到目标摄像头；设备没有对应头时降级为理想值
    md.getUserMedia({ video: { facingMode: { exact: facing } }, audio: false })
      .catch((e: { name?: string }) => {
        if (e?.name === "OverconstrainedError" || e?.name === "NotFoundError") {
          return md.getUserMedia({ video: { facingMode: facing }, audio: false });
        }
        throw e;
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        window.clearTimeout(timer);
        setError(null);
        const devId = s.getVideoTracks()[0]?.getSettings().deviceId;
        if (lastDeviceId.current && lastDeviceId.current === devId) {
          toast("这台设备只有一个摄像头，没法翻转");
        }
        lastDeviceId.current = devId ?? null;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
      })
      .catch(() => {
        if (!cancelled) setError("相机暂时打不开（可能没授权）。可以先从相册选照片。");
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(noteTimer.current);
      stream?.getTracks().forEach((t) => t.stop());
      setLastShot((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return prev;
      });
    };
  }, [facing]);

  async function flipCamera() {
    const md = navigator.mediaDevices;
    if (md?.enumerateDevices) {
      try {
        const devices = await md.enumerateDevices();
        const videoCount = devices.filter((d) => d.kind === "videoinput").length;
        if (videoCount < 2) {
          toast("这台设备只有一个摄像头，没法翻转");
          return;
        }
      } catch {
        // 枚举失败就走正常切换流程
      }
    }
    setFacing((f) => (f === "environment" ? "user" : "environment"));
  }

  async function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    if (!blob) return;
    setFlash(true);
    window.setTimeout(() => setFlash(false), 180);
    const r = await archivePhoto(blob, Date.now(), "camera", { batchId: sessionBatchId });
    setLastShot((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { url: URL.createObjectURL(blob), ok: !!r.courseName };
    });
    setShotCount((c) => c + 1);
    setShotNote(r.courseName ? `已归入「${r.courseName}」` : "没认出课，已存待分类");
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setShotNote(""), 2600);
  }

  function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setShotNote(`解析中 0/${files.length}…`);
    void archiveFiles(files, (done, total) => setShotNote(`解析中 ${done}/${total}…`)).then(
      (r) => {
        toastBatch(r);
        setShotNote("");
      },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      {error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <p className="text-sm leading-6 text-white/80">{error}</p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex min-h-12 items-center gap-2 rounded-xl bg-white/15 px-6 text-sm font-medium"
          >
            <ImagePlus className="size-4" />
            从相册选照片
          </button>
          <button type="button" onClick={() => router.history.back()} className="min-h-11 px-4 text-sm text-white/60">
            先不弄了
          </button>
        </div>
      ) : (
        <>
          <video ref={videoRef} playsInline muted className="min-h-0 w-full flex-1 object-cover" />
          <button
            type="button"
            aria-label="关闭相机"
            onClick={() => router.history.back()}
            className="absolute top-4 right-4 rounded-full bg-black/40 p-2"
          >
            <X className="size-5" />
          </button>
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent pb-10 pt-8">
            {shotNote && (
              <p className="mb-2 text-center text-xs text-white/85">{shotNote}</p>
            )}
            <div className="flex items-center justify-around">
              <button
                type="button"
                aria-label="从相册选照片"
                onClick={() => fileRef.current?.click()}
                className="relative size-12 overflow-hidden rounded-lg bg-white/15 active:scale-95"
              >
                {lastShot ? (
                  <>
                    <img src={lastShot.url} alt="" className="size-full object-cover" />
                    <span
                      className={`absolute right-0.5 top-0.5 min-w-4 rounded-full px-1 text-center text-[10px] font-semibold leading-4 text-white ${lastShot.ok ? "bg-green-500" : "bg-white/40"}`}
                    >
                      {shotCount}
                    </span>
                  </>
                ) : (
                  <ImagePlus className="mx-auto size-5" />
                )}
              </button>
              <button
                type="button"
                aria-label="拍照"
                onClick={() => void shoot()}
                className="size-20 rounded-full border-4 border-white bg-white/25 transition-transform active:scale-95"
              />
              <button
                type="button"
                aria-label="翻转摄像头"
                onClick={flipCamera}
                className="flex size-12 items-center justify-center rounded-full bg-white/15 transition-transform active:scale-90"
              >
                <SwitchCamera className="size-5" />
              </button>
            </div>
          </div>
        </>
      )}
      {flash && <div className="pointer-events-none absolute inset-0 bg-white/80" />}
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />
      <Toaster />
    </div>
  );
}
