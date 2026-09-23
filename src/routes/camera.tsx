import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Camera as CameraIcon, Check, ImagePlus, Settings, SwitchCamera, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  archiveFiles,
  archivePhoto,
  archiveShot,
  readCaptureTime,
  suggestShot,
  type BatchResult,
  type ShotSuggestion,
} from "@/lib/archive";
import { getSettings, listCourses, uid } from "@/lib/db";
import { minToHHmm } from "@/lib/periods";
import { slotWeekLabel } from "@/lib/match";
import { isNativeApp, takePhotoWithSystemCamera } from "@/lib/native";
import type { CaptureSource, Course } from "@/lib/types";

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

/** 拍照页：原生调系统相机（原生画质/对焦/变焦），网页端保留应用内取景 */
function CameraPage() {
  if (isNativeApp()) return <NativeCameraPage />;
  return <WebCameraPage />;
}

/** 待确认的一张照片：大图预览 + 自动识别结果/原因，用户拍板归哪门 */
type ConfirmState = {
  blob: Blob;
  url: string;
  capturedAt: number;
  source: CaptureSource;
  suggest: ShotSuggestion;
};

/**
 * 原生拍照：第一张拍完弹「归档确认卡」（自动识别《XX》→ 就归这门 / 换一门 / 待分类），
 * 确认后本批连拍沿用该课程不再打断；归档引擎缺配置（学期锚点/课表）时把原因直接说出来。
 */
function NativeCameraPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [needSetup, setNeedSetup] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"confirm" | "batch">("confirm");
  // 本批已确认的归属（第一张拍板后沿用，连拍不打断）
  const [batchCourse, setBatchCourse] = useState<{ id: string | null; name: string | null } | null>(
    null,
  );
  const [shotCount, setShotCount] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  const [sessionBatchId] = useState(() => uid());

  useEffect(() => {
    void Promise.all([getSettings(), listCourses()]).then(([s, cs]) => {
      setCourses(cs);
      setNeedSetup(!s.semesterStart);
    });
    return () => window.clearTimeout(flashTimer.current);
  }, []);

  function showFlash(name: string | null) {
    setFlash(name ?? "待分类");
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1400);
  }

  function discardConfirm() {
    if (!confirmState) return;
    URL.revokeObjectURL(confirmState.url);
    setConfirmState(null);
  }

  async function shoot() {
    if (busy || confirmState) return;
    setBusy(true);
    setError(null);
    try {
      const file = await takePhotoWithSystemCamera();
      if (!file) return; // 用户取消
      const { t, source } = await readCaptureTime(file);
      if (batchCourse) {
        await archiveShot(file, t, source, { courseId: batchCourse.id, batchId: sessionBatchId });
        setShotCount((c) => c + 1);
        showFlash(batchCourse.name);
      } else {
        // 本批第一张：先给识别结果，用户拍板后再入库
        const suggest = await suggestShot(t);
        setConfirmState({
          blob: file,
          url: URL.createObjectURL(file),
          capturedAt: t,
          source,
          suggest,
        });
      }
    } catch {
      setError("相机出了点问题，再试一次；也可以先从相册选照片。");
      toast.error("拍照失败，重试一次");
    } finally {
      setBusy(false);
    }
  }

  async function commit(courseId: string | null) {
    const c = confirmState;
    if (!c) return;
    const name = await archiveShot(c.blob, c.capturedAt, c.source, {
      courseId,
      batchId: sessionBatchId,
    });
    setBatchCourse({ id: courseId, name });
    setShotCount((x) => x + 1);
    discardConfirm();
    showFlash(name);
  }

  function openPicker(mode: "confirm" | "batch") {
    setPickerMode(mode);
    setPickerOpen(true);
  }

  function pickCourse(courseId: string | null) {
    setPickerOpen(false);
    if (pickerMode === "confirm") {
      void commit(courseId);
    } else {
      setBatchCourse({ id: courseId, name: courses.find((c) => c.id === courseId)?.name ?? null });
    }
  }

  function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setImporting(`解析中 0/${files.length}…`);
    void archiveFiles(files, (done, total) => setImporting(`解析中 ${done}/${total}…`)).then(
      (r) => {
        toastBatch(r);
        setImporting(null);
      },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black pt-[env(safe-area-inset-top)] text-white">
      {needSetup && !confirmState && (
        <button
          type="button"
          onClick={() => router.navigate({ to: "/settings" })}
          className="flex items-center gap-2 bg-amber-500/90 px-4 py-2.5 text-left text-xs font-medium text-black"
        >
          <Settings className="size-4 shrink-0" />
          还没设置学期起始日，自动归档开不了——去设置（30 秒）
        </button>
      )}

      {confirmState ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between px-3 pt-4">
            <span className="text-xs text-white/60">本批第 {shotCount + 1} 张，归到哪？</span>
            <button
              type="button"
              aria-label="丢弃这张"
              onClick={discardConfirm}
              className="rounded-full p-2 active:bg-white/10"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-3">
            <img src={confirmState.url} alt="刚拍的照片" className="max-h-[38vh] w-auto rounded-xl" />
          </div>
          <div className="shrink-0 px-6 text-center">
            {confirmState.suggest.slot && confirmState.suggest.course ? (
              <>
                <p className="text-xs text-white/60">自动识别</p>
                <p className="mt-0.5 text-2xl font-semibold text-green-400">
                  《{confirmState.suggest.course.name}》
                </p>
                <p className="mt-1 text-xs text-white/60">
                  {minToHHmm(confirmState.suggest.slot.startMin)}–
                  {minToHHmm(confirmState.suggest.slot.endMin)} ·{" "}
                  {slotWeekLabel(confirmState.suggest.slot)}
                </p>
              </>
            ) : (
              <p className="text-sm leading-6 text-amber-300">{confirmState.suggest.reason}</p>
            )}
          </div>
          <div className="shrink-0 space-y-2 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
            {confirmState.suggest.course ? (
              <button
                type="button"
                onClick={() => void commit(confirmState.suggest.course!.id)}
                className="flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-green-600 text-base font-semibold text-white active:scale-[0.98]"
              >
                <Check className="size-5" />
                就归《{confirmState.suggest.course.name}》
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openPicker("confirm")}
                className="flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl bg-white text-base font-semibold text-black active:scale-[0.98]"
              >
                选一门课程归档
              </button>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => openPicker("confirm")}
                className="min-h-11 flex-1 rounded-xl bg-white/10 text-sm font-medium active:bg-white/20"
              >
                换一门
              </button>
              <button
                type="button"
                onClick={() => void commit(null)}
                className="min-h-11 flex-1 rounded-xl bg-white/10 text-sm font-medium active:bg-white/20"
              >
                先待分类
              </button>
            </div>
            <p className="text-center text-[11px] leading-4 text-white/40">
              确认后本批连拍都归这一门
              {confirmState.suggest.course ? "，之后可点上方批次条再换" : ""}
            </p>
          </div>
        </div>
      ) : (
        <div className="relative flex flex-1 flex-col items-center justify-center gap-5 px-10 text-center">
          {error ? (
            <p className="text-sm leading-6 text-white/80">{error}</p>
          ) : (
            <>
              {shotCount > 0 && batchCourse && (
                <div className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs">
                  <span>
                    本批 {shotCount} 张 ·{" "}
                    {batchCourse.name ? `归《${batchCourse.name}》` : "待分类"}
                  </span>
                  <button
                    type="button"
                    onClick={() => openPicker("batch")}
                    className="font-medium text-white underline underline-offset-2 active:opacity-70"
                  >
                    换
                  </button>
                </div>
              )}
              <p className="text-sm leading-6 text-white/80">
                {shotCount > 0
                  ? `已归档 ${shotCount} 张，继续拍${batchCourse?.name ? `还是《${batchCourse.name}》` : "还是待分类"}`
                  : "点下方按钮调用系统相机拍摄"}
                <br />
                第一张拍完选一次课程，后面连拍不用再管
              </p>
              <button
                type="button"
                aria-label="拍照"
                disabled={busy}
                onClick={() => void shoot()}
                className="size-24 rounded-full border-4 border-white bg-white/25 transition-transform active:scale-95 disabled:opacity-50"
              >
                <CameraIcon className="mx-auto size-9" />
              </button>
            </>
          )}

          {flash && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-2xl bg-white/15 px-8 py-5 text-center backdrop-blur">
                <Check className="mx-auto size-9 text-green-400" />
                <p className="mt-1.5 text-lg font-semibold">
                  {flash === "待分类" ? "已存待分类" : `已归入《${flash}》`}
                </p>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!!importing}
            className="flex min-h-12 items-center gap-2 rounded-xl bg-white/15 px-6 text-sm font-medium disabled:opacity-60"
          >
            <ImagePlus className="size-4" />
            {importing ?? "从相册选照片"}
          </button>
          <button
            type="button"
            onClick={() => router.history.back()}
            className="min-h-11 px-4 text-sm text-white/60"
          >
            {shotCount > 0 ? `完成${batchCourse ? "" : "（本次未归档）"}` : "先不弄了"}
          </button>
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />

      <Drawer open={pickerOpen} onOpenChange={(o) => !o && setPickerOpen(false)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{pickerMode === "confirm" ? "这张归到哪门课？" : "本批后续照片归哪门？"}</DrawerTitle>
          </DrawerHeader>
          <div className="max-h-72 space-y-1 overflow-y-auto px-4 pb-8">
            {courses.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                还没有课程，去「课程库」或「课表」先建一门
              </p>
            )}
            {courses.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pickCourse(c.id)}
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
              onClick={() => pickCourse(null)}
              className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 active:bg-muted"
            >
              <span className="size-3 shrink-0 rounded-full bg-amber-400" />
              <span className="text-sm">待分类</span>
            </button>
          </div>
        </DrawerContent>
      </Drawer>

      <Toaster duration={2800} />
    </div>
  );
}

/** 全屏相机（网页端）：拍完自动归档，缩略图角标反馈（不打断取景），toast 只留给异常 */
function WebCameraPage() {
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
    <div className="fixed inset-0 z-50 flex flex-col bg-black pt-[env(safe-area-inset-top)] text-white">
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
            className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 rounded-full bg-black/40 p-2"
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
      <Toaster duration={2800} />
    </div>
  );
}
