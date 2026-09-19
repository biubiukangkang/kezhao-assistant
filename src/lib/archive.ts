import exifr from "exifr";
import { getSettings, listCourses, listPhotos, listSlots, savePhoto, uid } from "./db";
import { matchPhoto } from "./match";
import type { CaptureSource, Photo } from "./types";

export type ProgressFn = (done: number, total: number) => void;

/** 入库前把照片压到长边 2048（板书足够清晰），体积降 80%+；解码失败（如 HEIC）原样保存 */
async function compressImage(blob: Blob, maxEdge = 2048): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const edge = Math.max(bmp.width, bmp.height);
    if (edge <= maxEdge) {
      bmp.close?.();
      return blob;
    }
    const scale = maxEdge / edge;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    return out ?? blob;
  } catch {
    return blob;
  }
}

/** 读照片真实拍摄时间：EXIF（DateTimeOriginal/CreateDate）优先，读不到回退文件修改时间 */
async function readCaptureTime(f: File): Promise<{ t: number; source: CaptureSource }> {
  try {
    const exif = await exifr.parse(f);
    const d = exif?.DateTimeOriginal ?? exif?.CreateDate;
    if (d instanceof Date && !Number.isNaN(d.getTime()) && d.getTime() > 0) {
      return { t: d.getTime(), source: "exif" };
    }
  } catch {
    // 无 EXIF 或格式不支持（如部分截图、HEIC）
  }
  return { t: f.lastModified, source: "mtime" };
}

/** 一张照片入库：压缩 → 按拍摄时间匹配课表，命中归课程，否则进待分类 */
export async function archivePhoto(
  blob: Blob,
  capturedAt: number,
  source: CaptureSource,
  opts: { sourceKey?: string; batchId?: string } = {},
): Promise<ArchiveResult> {
  if (opts.sourceKey) {
    const existing = await listPhotos();
    if (existing.some((p) => p.sourceKey === opts.sourceKey)) {
      return { courseId: null, courseName: null, duplicate: true };
    }
  }
  const [settings, slots, courses] = await Promise.all([getSettings(), listSlots(), listCourses()]);
  const slot = matchPhoto(capturedAt, slots, settings);
  const course = slot ? courses.find((c) => c.id === slot.courseId) : undefined;
  const stored = await compressImage(blob);
  const photo: Photo = {
    id: uid(),
    courseId: slot?.courseId ?? null,
    capturedAt,
    capturedSource: source,
    storageKey: "local",
    matchMethod: slot ? "auto" : "unmatched",
    batchId: opts.batchId ?? uid(),
    starred: false,
    blob: stored,
    ...(opts.sourceKey ? { sourceKey: opts.sourceKey } : {}),
    createdAt: Date.now(),
  };
  await savePhoto(photo);
  return { courseId: photo.courseId, courseName: course?.name ?? null, duplicate: false };
}

/** 批量导入（相册多选）：拍摄时间 EXIF 优先、修改时间兜底；去重键含解析后时间 */
export async function archiveFiles(
  files: File[],
  onProgress?: ProgressFn,
): Promise<BatchResult> {
  const batchId = uid();
  const result: BatchResult = { archived: 0, pending: 0, duplicates: 0 };
  const existing = await listPhotos();
  const seen = new Set(existing.map((p) => p.sourceKey));
  const images = files.filter((f) => f.type.startsWith("image/"));
  let done = 0;
  for (const f of images) {
    const { t, source } = await readCaptureTime(f);
    const sourceKey = `${f.size}-${t}`;
    if (seen.has(sourceKey)) {
      result.duplicates += 1;
      done += 1;
      onProgress?.(done, images.length);
      continue;
    }
    seen.add(sourceKey);
    const r = await archivePhoto(f, t, source, { sourceKey, batchId });
    if (r.courseId) result.archived += 1;
    else result.pending += 1;
    done += 1;
    onProgress?.(done, images.length);
  }
  return result;
}

/** 从课程相册手动加照片：直接指定课程（不做课表匹配），去重键含解析后时间 */
export async function addPhotosToCourse(
  files: File[],
  courseId: string | null,
  onProgress?: ProgressFn,
): Promise<BatchResult> {
  const batchId = uid();
  const result: BatchResult = { archived: 0, pending: 0, duplicates: 0 };
  const existing = await listPhotos();
  const seen = new Set(existing.map((p) => p.sourceKey));
  const images = files.filter((f) => f.type.startsWith("image/"));
  let done = 0;
  for (const f of images) {
    const { t, source } = await readCaptureTime(f);
    const sourceKey = `${f.size}-${t}`;
    if (seen.has(sourceKey)) {
      result.duplicates += 1;
      done += 1;
      onProgress?.(done, images.length);
      continue;
    }
    seen.add(sourceKey);
    const stored = await compressImage(f);
    await savePhoto({
      id: uid(),
      courseId,
      capturedAt: t,
      capturedSource: source,
      storageKey: "local",
      matchMethod: courseId ? "manual" : "unmatched",
      batchId,
      starred: false,
      blob: stored,
      sourceKey,
      createdAt: Date.now(),
    });
    if (courseId) result.archived += 1;
    else result.pending += 1;
    done += 1;
    onProgress?.(done, images.length);
  }
  return result;
}

export type ArchiveResult = {
  courseId: string | null;
  courseName: string | null;
  duplicate: boolean;
};

export type BatchResult = { archived: number; pending: number; duplicates: number };
