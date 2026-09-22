import exifr from "exifr";
import {
  getSettings,
  hasSourceKey,
  listCourses,
  listPhotos,
  listSlots,
  savePhoto,
  savePhotos,
  uid,
} from "./db";
import { matchPhoto, getSemesterWeek } from "./match";
import { mirrorPhotoIfEnabled } from "./photo-folder";
import type { CaptureSource, Course, Photo, ScheduleSlot } from "./types";

export type ProgressFn = (done: number, total: number) => void;

const THUMB_EDGE = 480;

function drawToBlob(bmp: ImageBitmap, maxEdge: number, quality: number): Promise<Blob | null> {
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * 入库前处理：长边压到 2048（板书足够清晰），顺带生成 480 缩略图（列表用）。
 * 一次解码复用 bitmap；解码失败（如 HEIC）原样保存、无缩略图。
 */
async function compressWithThumb(
  blob: Blob,
): Promise<{ stored: Blob; thumb: Blob | undefined }> {
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const edge = Math.max(bmp.width, bmp.height);
    let stored = blob;
    if (edge > 2048) {
      stored = (await drawToBlob(bmp, 2048, 0.9)) ?? blob;
    }
    const thumb = edge > THUMB_EDGE ? ((await drawToBlob(bmp, THUMB_EDGE, 0.75)) ?? undefined) : undefined;
    bmp.close?.();
    return { stored, thumb };
  } catch {
    return { stored: blob, thumb: undefined };
  }
}

/** 给已有照片补缩略图（旧数据回填），解码失败返回 undefined */
export async function makeThumb(blob: Blob): Promise<Blob | undefined> {
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
    if (Math.max(bmp.width, bmp.height) <= THUMB_EDGE) {
      bmp.close?.();
      return undefined;
    }
    const thumb = (await drawToBlob(bmp, THUMB_EDGE, 0.75)) ?? undefined;
    bmp.close?.();
    return thumb;
  } catch {
    return undefined;
  }
}

/** 读照片真实拍摄时间：EXIF（DateTimeOriginal/CreateDate）优先，读不到回退文件修改时间 */
export async function readCaptureTime(f: File): Promise<{ t: number; source: CaptureSource }> {
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
  if (opts.sourceKey && (await hasSourceKey(opts.sourceKey))) {
    return { courseId: null, courseName: null, duplicate: true };
  }
  const [settings, slots, courses] = await Promise.all([getSettings(), listSlots(), listCourses()]);
  const slot = matchPhoto(capturedAt, slots, settings);
  const course = slot ? courses.find((c) => c.id === slot.courseId) : undefined;
  const { stored, thumb } = await compressWithThumb(blob);
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
    ...(thumb ? { thumb } : {}),
    ...(opts.sourceKey ? { sourceKey: opts.sourceKey } : {}),
    createdAt: Date.now(),
  };
  await savePhoto(photo);
  void mirrorPhotoIfEnabled(photo); // 已开启同步文件夹时镜像一份（不阻塞主流程）
  return { courseId: photo.courseId, courseName: course?.name ?? null, duplicate: false };
}

/** 批量导入（相册多选）：拍摄时间 EXIF 优先、修改时间兜底；去重键含解析后时间 */
export async function archiveFiles(
  files: File[],
  onProgress?: ProgressFn,
): Promise<BatchResult> {
  const batchId = uid();
  const result: BatchResult = { archived: 0, pending: 0, duplicates: 0 };
  const seen = new Set<string>(); // 仅防同一批内重复，库内重复走 by-source 索引
  const images = files.filter((f) => f.type.startsWith("image/"));
  let done = 0;
  for (const f of images) {
    const { t, source } = await readCaptureTime(f);
    const sourceKey = `${f.size}-${t}`;
    if (seen.has(sourceKey)) {
      result.duplicates += 1;
    } else {
      seen.add(sourceKey);
      const r = await archivePhoto(f, t, source, { sourceKey, batchId });
      if (r.duplicate) result.duplicates += 1;
      else if (r.courseId) result.archived += 1;
      else result.pending += 1;
    }
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
  const seen = new Set<string>();
  const images = files.filter((f) => f.type.startsWith("image/"));
  let done = 0;
  for (const f of images) {
    const { t, source } = await readCaptureTime(f);
    const sourceKey = `${f.size}-${t}`;
    if (seen.has(sourceKey) || (await hasSourceKey(sourceKey))) {
      result.duplicates += 1;
    } else {
      seen.add(sourceKey);
      const { stored, thumb } = await compressWithThumb(f);
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
        ...(thumb ? { thumb } : {}),
        sourceKey,
        createdAt: Date.now(),
      });
      if (courseId) result.archived += 1;
      else result.pending += 1;
    }
    done += 1;
    onProgress?.(done, images.length);
  }
  return result;
}

/**
 * 按当前课表/学期锚点重新匹配全库照片（课表录晚了、锚点改对了之后的一键补救）。
 * 手动指定过的照片（manual）不动，只重算 auto / unmatched / 待分类。
 */
export async function rematchPhotos(): Promise<{ moved: number; matched: number }> {
  const [settings, slots, photos] = await Promise.all([getSettings(), listSlots(), listPhotos()]);
  const changed: Photo[] = [];
  let matched = 0;
  for (const p of photos) {
    if (p.matchMethod === "manual") continue;
    const slot = matchPhoto(p.capturedAt, slots, settings);
    const courseId = slot?.courseId ?? null;
    const method = slot ? "auto" : "unmatched";
    if (courseId !== p.courseId || p.matchMethod !== method) {
      changed.push({ ...p, courseId, matchMethod: method });
    }
    if (courseId) matched += 1;
  }
  if (changed.length > 0) await savePhotos(changed);
  return { moved: changed.length, matched };
}

export type ArchiveResult = {
  courseId: string | null;
  courseName: string | null;
  duplicate: boolean;
};

export type ShotSuggestion = {
  slot: ScheduleSlot | null;
  course: Course | null;
  /** slot 为 null 时给用户看的原因（配置缺失必须可见，不能静默进待分类） */
  reason: string | null;
};

/**
 * 拍照归档预检：只算匹配不写库，供拍照页展示"自动识别《XX》/ 为什么没认出"。
 * 归档引擎需要三个输入——照片时间、课表、学期锚点；后两个是用户配置，
 * 缺失时逐项说清原因，把隐形前置条件变成显式引导。
 */
export async function suggestShot(capturedAt: number): Promise<ShotSuggestion> {
  const [settings, slots, courses] = await Promise.all([getSettings(), listSlots(), listCourses()]);
  const slot = matchPhoto(capturedAt, slots, settings);
  if (slot) {
    return { slot, course: courses.find((c) => c.id === slot.courseId) ?? null, reason: null };
  }
  if (!settings.semesterStart) {
    return {
      slot: null,
      course: null,
      reason: "还没设置学期起始日，照片对不上课表（去 设置 → 课表 填一次就好）",
    };
  }
  if (getSemesterWeek(capturedAt, settings.semesterStart) === null) {
    return {
      slot: null,
      course: null,
      reason: "拍摄时间不在学期范围内，去 设置 检查学期起始日",
    };
  }
  if (slots.length === 0) {
    return { slot: null, course: null, reason: "课表还是空的，先去「课表」录两节课" };
  }
  return { slot: null, course: null, reason: "这个时间对不上课表里的任何一节课" };
}

/**
 * 拍照路径入库：课程归属由拍照页确认后传入（用户确认过 = manual，重匹配时不动它）。
 * 压缩 + 缩略图 + 镜像与 archivePhoto 同一套处理。
 */
export async function archiveShot(
  blob: Blob,
  capturedAt: number,
  source: CaptureSource,
  opts: { courseId: string | null; batchId: string },
): Promise<string | null> {
  const courses = await listCourses();
  const name = opts.courseId ? (courses.find((c) => c.id === opts.courseId)?.name ?? null) : null;
  const { stored, thumb } = await compressWithThumb(blob);
  const photo: Photo = {
    id: uid(),
    courseId: opts.courseId,
    capturedAt,
    capturedSource: source,
    storageKey: "local",
    matchMethod: opts.courseId ? "manual" : "unmatched",
    batchId: opts.batchId,
    starred: false,
    blob: stored,
    ...(thumb ? { thumb } : {}),
    createdAt: Date.now(),
  };
  await savePhoto(photo);
  void mirrorPhotoIfEnabled(photo);
  return name;
}

export type BatchResult = { archived: number; pending: number; duplicates: number };
