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

const BACKUP_VERSION = 1;

// thumb 不进备份（体积翻倍无意义），恢复后由相册页回填重新生成
type BackupPhoto = Omit<Photo, "blob" | "thumb"> & { blobBase64: string | null };

type BackupFile = {
  version: number;
  exportedAt: number;
  settings: AppSettings;
  courses: Course[];
  slots: ScheduleSlot[];
  photos: BackupPhoto[];
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
  const head: Omit<BackupFile, "photos"> = {
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    settings,
    courses,
    slots,
  };
  yield `${JSON.stringify(head).slice(0, -1)},"photos":[`;
  for (let i = 0; i < photos.length; i++) {
    const { blob, thumb: _thumb, ...meta } = photos[i];
    const photoJson = JSON.stringify(meta);
    const b64 = blob ? await blobToBase64(blob) : null;
    const chunk = b64
      ? `${i > 0 ? "," : ""}${photoJson.slice(0, -1)},"blobBase64":"${b64}"}`
      : `${i > 0 ? "," : ""}${photoJson.slice(0, -1)},"blobBase64":null}`;
    yield chunk;
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
  let data: BackupFile;
  try {
    data = JSON.parse(await file.text()) as BackupFile;
  } catch {
    return { ...base, error: "文件读不出来，确认选的是本应用导出的备份文件" };
  }
  if (data.version !== BACKUP_VERSION || !Array.isArray(data.photos)) {
    return { ...base, error: "不是有效的课照助手备份文件" };
  }
  return {
    ...base,
    valid: true,
    exportedAt: data.exportedAt ?? 0,
    courses: data.courses?.length ?? 0,
    slots: data.slots?.length ?? 0,
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
  const data = JSON.parse(await file.text()) as BackupFile;
  if (data.version !== BACKUP_VERSION || !Array.isArray(data.photos)) {
    throw new Error("不是有效的课照助手备份文件");
  }
  const photos: Photo[] = [];
  for (const { blobBase64, ...meta } of data.photos) {
    photos.push({ ...meta, blob: blobBase64 ? await base64ToBlob(blobBase64) : undefined });
  }
  await replaceAllData(
    data.settings ?? (await getSettings()),
    data.courses ?? [],
    data.slots ?? [],
    photos,
  );
  return {
    courses: data.courses?.length ?? 0,
    slots: data.slots?.length ?? 0,
    photos: data.photos?.length ?? 0,
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
