import {
  clearAllData,
  getMetaValue,
  getSettings,
  listAllPhotos,
  listCourses,
  listSlots,
  putMetaValue,
  saveCourse,
  savePhoto,
  saveSettings,
  saveSlot,
} from "./db";
import type { AppSettings, Course, Photo, ScheduleSlot } from "./types";

const BACKUP_VERSION = 1;

type BackupPhoto = Omit<Photo, "blob"> & { blobBase64: string | null };

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
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("照片读取失败"));
    reader.readAsDataURL(blob);
  });
}

async function base64ToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/** 导出全部数据（课表/课程/照片内嵌 base64，含回收站）为单个 JSON 文件 */
export async function exportBackup(): Promise<{ blob: Blob; filename: string }> {
  const [settings, courses, slots, photos] = await Promise.all([
    getSettings(),
    listCourses(),
    listSlots(),
    listAllPhotos(),
  ]);
  const photosOut: BackupPhoto[] = await Promise.all(
    photos.map(async ({ blob, ...meta }) => ({
      ...meta,
      blobBase64: blob ? await blobToBase64(blob) : null,
    })),
  );
  const data: BackupFile = {
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    settings,
    courses,
    slots,
    photos: photosOut,
  };
  const json = JSON.stringify(data);
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const filename = `课照助手备份-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  return { blob: new Blob([json], { type: "application/json" }), filename };
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

/** 从备份文件恢复：覆盖现有全部数据。返回恢复统计 */
export async function importBackup(
  file: File,
): Promise<{ courses: number; slots: number; photos: number }> {
  const data = JSON.parse(await file.text()) as BackupFile;
  if (data.version !== BACKUP_VERSION || !Array.isArray(data.photos)) {
    throw new Error("不是有效的课照助手备份文件");
  }
  await clearAllData();
  if (data.settings) await saveSettings(data.settings);
  for (const c of data.courses ?? []) await saveCourse(c);
  for (const s of data.slots ?? []) await saveSlot(s);
  for (const { blobBase64, ...meta } of data.photos ?? []) {
    await savePhoto({
      ...meta,
      blob: blobBase64 ? await base64ToBlob(blobBase64) : undefined,
    });
  }
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
