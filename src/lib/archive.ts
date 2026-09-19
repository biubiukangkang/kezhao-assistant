import { getSettings, listCourses, listPhotos, listSlots, savePhoto, uid } from "./db";
import { matchPhoto } from "./match";
import type { CaptureSource, Photo } from "./types";

export type ArchiveResult = {
  courseId: string | null;
  courseName: string | null;
  duplicate: boolean;
};

export type BatchResult = { archived: number; pending: number; duplicates: number };

/** 一张照片入库：按拍摄时间匹配课表，命中归课程，否则进待分类 */
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
  const photo: Photo = {
    id: uid(),
    courseId: slot?.courseId ?? null,
    capturedAt,
    capturedSource: source,
    storageKey: "local",
    matchMethod: slot ? "auto" : "unmatched",
    batchId: opts.batchId ?? uid(),
    starred: false,
    blob,
    ...(opts.sourceKey ? { sourceKey: opts.sourceKey } : {}),
    createdAt: Date.now(),
  };
  await savePhoto(photo);
  return { courseId: photo.courseId, courseName: course?.name ?? null, duplicate: false };
}

/** 批量导入（相册多选）：用文件修改时间兜底，size+修改时间去重 */
export async function archiveFiles(files: File[]): Promise<BatchResult> {
  const batchId = uid();
  const result: BatchResult = { archived: 0, pending: 0, duplicates: 0 };
  for (const f of files) {
    if (!f.type.startsWith("image/")) continue;
    const r = await archivePhoto(f, f.lastModified, "mtime", {
      sourceKey: `${f.size}-${f.lastModified}`,
      batchId,
    });
    if (r.duplicate) result.duplicates += 1;
    else if (r.courseId) result.archived += 1;
    else result.pending += 1;
  }
  return result;
}

/** 从课程相册手动加照片：直接指定课程（不做课表匹配），时间用文件修改时间 */
export async function addPhotosToCourse(
  files: File[],
  courseId: string | null,
): Promise<BatchResult> {
  const batchId = uid();
  const result: BatchResult = { archived: 0, pending: 0, duplicates: 0 };
  for (const f of files) {
    if (!f.type.startsWith("image/")) continue;
    const sourceKey = `${f.size}-${f.lastModified}`;
    const existing = await listPhotos();
    if (existing.some((p) => p.sourceKey === sourceKey)) {
      result.duplicates += 1;
      continue;
    }
    await savePhoto({
      id: uid(),
      courseId,
      capturedAt: f.lastModified,
      capturedSource: "mtime",
      storageKey: "local",
      matchMethod: courseId ? "manual" : "unmatched",
      batchId,
      starred: false,
      blob: f,
      sourceKey,
      createdAt: Date.now(),
    });
    if (courseId) result.archived += 1;
    else result.pending += 1;
  }
  return result;
}
