import {
  getMetaValue,
  getSettings,
  listAllPhotos,
  listCourses,
  listSlots,
  putMetaValue,
  replaceAllData,
} from "./db";
import type { AppSettings, Course, Photo, ScheduleSlot } from "./types";

const BACKUP_FORMAT = "kz-backup";
const BACKUP_VERSION = 2;

// thumb 不进备份（体积翻倍无意义），恢复后由相册页回填重新生成
export type BackupPhotoV2 = Omit<Photo, "blob" | "thumb"> & { blobBase64: string | null };

export type BackupFileV2 = {
  format: "kz-backup";
  version: 2;
  exportedAt: number;
  settings: AppSettings;
  courses: Course[];
  slots: ScheduleSlot[];
  photos: BackupPhotoV2[];
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r !== "string") {
        reject(new Error("照片读取失败"));
        return;
      }
      resolve(r.slice(r.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("照片读取失败"));
    reader.readAsDataURL(blob);
  });
}

async function base64ToBlob(dataUrl: string): Promise<Blob> {
  // 旧版备份存完整 dataURL，新版存纯 base64，两种都兼容
  const s = dataUrl.includes(",") ? dataUrl : `data:image/jpeg;base64,${dataUrl}`;
  const res = await fetch(s);
  return res.blob();
}

/** 备份头部文本块（kzb1 v2，§4.2/§9.5）：settings/courses/slots 一块，photos 数组由调用方续接 */
export function backupHeadChunk(
  settings: AppSettings,
  courses: Course[],
  slots: ScheduleSlot[],
  exportedAt: number,
): string {
  return `${JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    settings,
    courses,
    slots,
  }).slice(0, -1)},"photos":[`;
}

/** 单张照片的文本块；index 仅决定是否加前导逗号（首张前无逗号） */
export function backupPhotoChunk(photo: Photo, index: number, blobBase64: string | null): string {
  const { blob: _blob, thumb: _thumb, ...meta } = photo;
  const b64 = blobBase64 ? `"${blobBase64}"` : "null";
  return `${index > 0 ? "," : ""}${JSON.stringify(meta).slice(0, -1)},"blobBase64":${b64}}`;
}

/**
 * 流式产出备份 JSON 文本块：头部的课表/课程元信息一块，之后每张照片一块。
 * 消费方逐块处理（网页端收集进 Blob、原生端逐块追加写缓存文件），
 * 全程不 Promise.all、不整体 JSON.stringify，内存峰值从 ~4x 降到 ~1.4x。
 */
export async function* backupChunks(): AsyncGenerator<string> {
  const [settings, courses, slots, photos] = await Promise.all([
    getSettings(),
    listCourses(),
    listSlots(),
    listAllPhotos(),
  ]);
  yield backupHeadChunk(settings, courses, slots, Date.now());
  for (let i = 0; i < photos.length; i++) {
    const { blob } = photos[i];
    const b64 = blob ? await blobToBase64(blob) : null;
    yield backupPhotoChunk(photos[i], i, b64);
  }
  yield "]}";
}

export function backupFilename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `课照助手备份-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

/** 导出全部数据（课表/课程/照片内嵌 base64，含回收站）为单个 JSON Blob。网页端下载用 */
export async function exportBackup(): Promise<{ blob: Blob; filename: string }> {
  const parts: string[] = [];
  for await (const chunk of backupChunks()) parts.push(chunk);
  return { blob: new Blob(parts, { type: "application/json" }), filename: backupFilename() };
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * blobBase64 三形态（§4.2）：null（无图）/ 纯 base64 / 完整 dataURL。
 * 空串按无图兼容（旧数据或手改文件可能出现）。
 */
function isValidBlobBase64(v: unknown): boolean {
  if (v === null || v === "") return true;
  if (typeof v !== "string") return false;
  if (v.includes(",")) {
    // 完整 dataURL 形态，前缀必须是 data:
    if (!v.startsWith("data:")) return false;
    return BASE64_RE.test(v.slice(v.indexOf(",") + 1));
  }
  return BASE64_RE.test(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 解析并校验备份文本（纯函数：不碰 Capacitor/IndexedDB，node 环境可单测）。
 * 只认 kzb1 v2：format !== "kz-backup" 或 version !== 2 → 抛「版本过旧，无法恢复」（v1 不迁移）。
 * 所有校验失败都在此抛出——调用方（inspectBackup/importBackup）保证写库前先过这一关。
 */
export function parseBackupText(text: string): BackupFileV2 {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("文件读不出来，确认选的是本应用导出的备份文件");
  }
  if (!isRecord(raw)) throw new Error("不是有效的课照助手备份文件");
  if (raw.format !== BACKUP_FORMAT || raw.version !== BACKUP_VERSION) {
    throw new Error("版本过旧，无法恢复");
  }
  if (!isRecord(raw.settings)) throw new Error("备份文件缺少设置信息");
  if (!Array.isArray(raw.courses)) throw new Error("备份文件缺少课程数据");
  if (!Array.isArray(raw.slots)) throw new Error("备份文件缺少课表时段数据");
  if (!Array.isArray(raw.photos)) throw new Error("备份文件缺少照片数据");
  for (const p of raw.photos) {
    if (!isRecord(p) || typeof p.id !== "string" || !p.id || typeof p.capturedAt !== "number") {
      throw new Error("备份里有照片记录不完整");
    }
    if (!isValidBlobBase64(p.blobBase64)) throw new Error("备份里有照片数据损坏");
  }
  return raw as BackupFileV2;
}

export type BackupPreview = {
  valid: boolean;
  error?: string;
  exportedAt: number;
  courses: number;
  slots: number;
  photos: number;
  starred: number;
  sizeMB: string;
};

/** 解析备份文件（不写入），供恢复前预览"将覆盖什么" */
export async function inspectBackup(file: File): Promise<BackupPreview> {
  const base: BackupPreview = {
    valid: false,
    exportedAt: 0,
    courses: 0,
    slots: 0,
    photos: 0,
    starred: 0,
    sizeMB: (file.size / 1024 / 1024).toFixed(1),
  };
  let data: BackupFileV2;
  try {
    data = parseBackupText(await file.text());
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : "不是有效的课照助手备份文件" };
  }
  return {
    ...base,
    valid: true,
    exportedAt: data.exportedAt ?? 0,
    courses: data.courses.length,
    slots: data.slots.length,
    photos: data.photos.length,
    starred: data.photos.filter((p) => p.starred).length,
  };
}

/**
 * 从备份文件恢复：覆盖课表/课程/照片。
 * 先把全部记录（含照片 blob）解析构造完，任何一步失败都发生在写库之前；
 * 最后经 replaceAllData 单事务原子写入——不会出现旧的已删、新的没写完的半残库。
 * 文件夹句柄、相册开关等本机配置（meta）跨恢复保留。
 */
export async function importBackup(
  file: File,
): Promise<{ courses: number; slots: number; photos: number }> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error("文件读不出来，确认选的是本应用导出的备份文件");
  }
  // 先全量解析校验，失败在此抛出，不写库
  const data = parseBackupText(text);
  const photos: Photo[] = [];
  for (const { blobBase64, ...meta } of data.photos) {
    photos.push({ ...meta, blob: blobBase64 ? await base64ToBlob(blobBase64) : undefined });
  }
  await replaceAllData(data.settings, data.courses, data.slots, photos);
  return {
    courses: data.courses.length,
    slots: data.slots.length,
    photos: data.photos.length,
  };
}

// ---------- 备份提醒 ----------

const REMINDER_KEY = "backupReminder";
const REMIND_THRESHOLD = 30; // 新增照片达到 30 张提醒一次
const REMIND_INTERVAL_MS = 24 * 60 * 60 * 1000; // 同一波增长最多 24 小时提醒一次

type ReminderState = { lastCount: number; remindedAt: number };

async function getReminder(): Promise<ReminderState> {
  return (await getMetaValue<ReminderState>(REMINDER_KEY)) ?? { lastCount: 0, remindedAt: 0 };
}

/**
 * 检查是否需要提醒备份：新增照片达阈值且距上次提醒超过 24h。
 * 返回应提醒的新增数量（0 = 不提醒）。
 */
export async function checkBackupReminder(): Promise<number> {
  const state = await getReminder();
  const photos = await listAllPhotos();
  const added = photos.length - state.lastCount;
  if (added < REMIND_THRESHOLD) return 0;
  if (state.remindedAt && Date.now() - state.remindedAt < REMIND_INTERVAL_MS) return 0;
  await putMetaValue(REMINDER_KEY, { lastCount: photos.length, remindedAt: Date.now() });
  return added;
}

/** 用户导出备份后调用：基线重置为当前照片数 */
export async function markBackupDone(): Promise<void> {
  const photos = await listAllPhotos();
  await putMetaValue(REMINDER_KEY, { lastCount: photos.length, remindedAt: Date.now() });
}
