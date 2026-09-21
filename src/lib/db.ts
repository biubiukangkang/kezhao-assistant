import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { DEFAULT_PERIODS } from "./periods";
import type { AppSettings, Course, Photo, ScheduleSlot } from "./types";

interface KezhaoDB extends DBSchema {
  courses: { key: string; value: Course };
  slots: { key: string; value: ScheduleSlot; indexes: { "by-course": string } };
  photos: {
    key: string;
    value: Photo;
    indexes: { "by-course": string; "by-batch": string };
  };
  meta: { key: string; value: unknown };
}

const DB_NAME = "kezhaodb";
const SETTINGS_KEY = "settings";

let dbPromise: Promise<IDBPDatabase<KezhaoDB>> | null = null;

function getDB() {
  dbPromise ??= openDB<KezhaoDB>(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore("courses", { keyPath: "id" });
      const slots = db.createObjectStore("slots", { keyPath: "id" });
      slots.createIndex("by-course", "courseId");
      const photos = db.createObjectStore("photos", { keyPath: "id" });
      photos.createIndex("by-course", "courseId");
      photos.createIndex("by-batch", "batchId");
      db.createObjectStore("meta");
    },
  });
  return dbPromise;
}

export function uid(): string {
  return crypto.randomUUID();
}

// ---------- 设置 ----------

export const DEFAULT_SETTINGS: AppSettings = {
  semesterStart: "", // 未设置则匹配全部降级为待分类
  periods: DEFAULT_PERIODS,
};

export async function getSettings(): Promise<AppSettings> {
  const db = await getDB();
  const saved = (await db.get("meta", SETTINGS_KEY)) as AppSettings | undefined;
  return saved ?? DEFAULT_SETTINGS;
}

export async function saveSettings(s: AppSettings): Promise<void> {
  const db = await getDB();
  await db.put("meta", s, SETTINGS_KEY);
}

// ---------- 课程 ----------

export async function listCourses(): Promise<Course[]> {
  const db = await getDB();
  const all = await db.getAll("courses");
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveCourse(c: Course): Promise<void> {
  const db = await getDB();
  await db.put("courses", c);
}

/** 删除课程：课时段一并删除；照片保留但回到待分类（不丢用户照片） */
export async function deleteCourse(id: string): Promise<void> {
  const db = await getDB();
  const slots = await db.getAllFromIndex("slots", "by-course", id);
  const photos = await db.getAllFromIndex("photos", "by-course", id);
  const tx = db.transaction(["courses", "slots", "photos"], "readwrite");
  for (const s of slots) tx.objectStore("slots").delete(s.id);
  for (const p of photos) {
    tx.objectStore("photos").put({ ...p, courseId: null, matchMethod: "unmatched" });
  }
  tx.objectStore("courses").delete(id);
  await tx.done;
}

// ---------- 课时段 ----------

export async function listSlots(): Promise<ScheduleSlot[]> {
  const db = await getDB();
  const all = await db.getAll("slots");
  return all.sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin);
}

export async function saveSlot(s: ScheduleSlot): Promise<void> {
  const db = await getDB();
  await db.put("slots", s);
}

export async function deleteSlot(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("slots", id);
}

// ---------- 照片 ----------

export async function listPhotos(): Promise<Photo[]> {
  const db = await getDB();
  const all = await db.getAll("photos");
  return all
    .filter((p) => !p.deletedAt)
    .sort((a, b) => b.capturedAt - a.capturedAt);
}

/** 回收站里的照片（新删的在前） */
export async function listDeletedPhotos(): Promise<Photo[]> {
  const db = await getDB();
  const all = await db.getAll("photos");
  return all
    .filter((p) => !!p.deletedAt)
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
}

/** 全部照片（含回收站），备份用 */
export async function listAllPhotos(): Promise<Photo[]> {
  const db = await getDB();
  const all = await db.getAll("photos");
  return all.sort((a, b) => b.capturedAt - a.capturedAt);
}

export async function savePhoto(p: Photo): Promise<void> {
  const db = await getDB();
  await db.put("photos", p);
}

/** 软删除：进回收站，30 天内可恢复 */
export async function softDeletePhoto(id: string): Promise<void> {
  const db = await getDB();
  const p = await db.get("photos", id);
  if (!p || p.deletedAt) return;
  await db.put("photos", { ...p, deletedAt: Date.now() });
}

export async function restorePhoto(id: string): Promise<void> {
  const db = await getDB();
  const p = await db.get("photos", id);
  if (!p) return;
  const { deletedAt: _dropped, ...rest } = p;
  await db.put("photos", rest);
}

/** 彻底删除（回收站内使用或过期清理） */
export async function deletePhoto(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("photos", id);
}

export const TRASH_DAYS = 30;
const TRASH_TTL_MS = TRASH_DAYS * 24 * 60 * 60 * 1000;

/** 惰性清理：彻底删除进回收站超过 30 天的照片。返回清理数量 */
export async function purgeExpiredPhotos(): Promise<number> {
  const db = await getDB();
  const all = await db.getAll("photos");
  const expired = all.filter((p) => p.deletedAt && Date.now() - p.deletedAt > TRASH_TTL_MS);
  for (const p of expired) await db.delete("photos", p.id);
  return expired.length;
}

// ---------- 数据管理 ----------

/** meta 表通用 KV（提醒阈值、文件夹句柄等本机状态） */
export async function getMetaValue<T>(key: string): Promise<T | undefined> {
  const db = await getDB();
  return (await db.get("meta", key)) as T | undefined;
}

export async function putMetaValue(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put("meta", value, key);
}

/** 照片同步文件夹的句柄（FileSystemDirectoryHandle 可结构化克隆存入 IndexedDB） */
export async function savePhotoFolder(h: FileSystemDirectoryHandle): Promise<void> {
  const db = await getDB();
  await db.put("meta", h, "photoFolder");
}

export async function getPhotoFolder(): Promise<FileSystemDirectoryHandle | null> {
  const db = await getDB();
  return ((await db.get("meta", "photoFolder")) as FileSystemDirectoryHandle | undefined) ?? null;
}

export async function clearPhotoFolder(): Promise<void> {
  const db = await getDB();
  await db.delete("meta", "photoFolder");
}

export async function clearAllData(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["courses", "slots", "photos", "meta"], "readwrite");
  tx.objectStore("courses").clear();
  tx.objectStore("slots").clear();
  tx.objectStore("photos").clear();
  tx.objectStore("meta").clear();
  await tx.done;
}
