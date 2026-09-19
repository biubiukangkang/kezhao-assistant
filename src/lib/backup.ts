import {
  clearAllData,
  getSettings,
  listCourses,
  listPhotos,
  listSlots,
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

/** 导出全部数据（课表/课程/照片内嵌 base64）为单个 JSON 文件 */
export async function exportBackup(): Promise<{ blob: Blob; filename: string }> {
  const [settings, courses, slots, photos] = await Promise.all([
    getSettings(),
    listCourses(),
    listSlots(),
    listPhotos(),
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
