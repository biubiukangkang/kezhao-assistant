import {
  clearPhotoFolder,
  getPhotoFolder,
  listCourses,
  listPhotos,
  savePhotoFolder,
} from "./db";
import type { Photo } from "./types";

/** TS 内置类型不含 File System Access 的权限方法，这里补齐 */
type PermissionAwareHandle = FileSystemDirectoryHandle & {
  queryPermission?: (d: { mode: "read" | "readwrite" }) => Promise<"granted" | "prompt" | "denied">;
  requestPermission?: (d: { mode: "read" | "readwrite" }) => Promise<"granted" | "prompt" | "denied">;
};

async function permissionOf(handle: FileSystemDirectoryHandle): Promise<"granted" | "prompt" | "denied"> {
  return (await (handle as PermissionAwareHandle).queryPermission?.({ mode: "readwrite" })) ?? "prompt";
}

export async function requestFolderPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  return (await (handle as PermissionAwareHandle).requestPermission?.({ mode: "readwrite" })) === "granted";
}

type DirPickerWindow = Window & {
  showDirectoryPicker?: (opts?: { mode?: "read" | "readwrite"; id?: string }) => Promise<FileSystemDirectoryHandle>;
};

/** 当前浏览器是否支持选择文件夹（Chrome/Edge 系） */
export function folderSupported(): boolean {
  return typeof (window as DirPickerWindow).showDirectoryPicker === "function";
}

/** 弹出系统文件夹选择器；返回文件夹名，取消/失败返回 null */
export async function pickFolder(): Promise<string | null> {
  const picker = (window as DirPickerWindow).showDirectoryPicker;
  if (!picker) return null;
  const handle = await picker({ mode: "readwrite", id: "kezhao-photos" });
  await savePhotoFolder(handle);
  return handle.name;
}

export async function folderState(): Promise<{
  name: string | null;
  permission: "granted" | "prompt" | "denied" | null;
}> {
  const handle = await getPhotoFolder();
  if (!handle) return { name: null, permission: null };
  return { name: handle.name, permission: await permissionOf(handle) };
}

/** 页面加载后第一次写入需要用户点一下重新授权 */
export async function regrantFolder(): Promise<boolean> {
  const handle = await getPhotoFolder();
  if (!handle) return false;
  return requestFolderPermission(handle);
}

export async function stopFolderSync(): Promise<void> {
  await clearPhotoFolder();
}

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

function fileNameFor(p: Photo, courseName: string | undefined): string {
  const d = new Date(p.capturedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const course = courseName ? sanitize(courseName) + "_" : "";
  return `${stamp}_${course}${p.id.slice(0, 6)}.jpg`;
}

/** 把一张照片写进同步文件夹（courseName 用于文件名，可从调用方传入避免重复查库） */
export async function mirrorPhoto(handle: FileSystemDirectoryHandle, p: Photo, courseName?: string): Promise<void> {
  if (!p.blob) return;
  const fh = await handle.getFileHandle(fileNameFor(p, courseName), { create: true });
  const w = await fh.createWritable();
  await w.write(p.blob);
  await w.close();
}

/** 镜像单张（入库后调用）：无文件夹/无权限时静默跳过 */
export async function mirrorPhotoIfEnabled(p: Photo): Promise<void> {
  try {
    const handle = await getPhotoFolder();
    if (!handle) return;
    if ((await permissionOf(handle)) !== "granted") return;
    const courses = await listCourses();
    const courseName = p.courseId ? courses.find((c) => c.id === p.courseId)?.name : undefined;
    await mirrorPhoto(handle, p, courseName);
  } catch {
    // 同步是副本，失败不打扰主流程；设置页可「立即同步全部」兜底
  }
}

/** 全量同步：把库里所有照片写进文件夹，返回成功张数 */
export async function syncAllPhotos(): Promise<{ ok: number; fail: number }> {
  const handle = await getPhotoFolder();
  if (!handle) throw new Error("还没有选择文件夹");
  if ((await permissionOf(handle)) !== "granted") {
    throw new Error("文件夹授权已过期，请重新授权");
  }
  const courses = await listCourses();
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const photos = await listPhotos();
  let ok = 0;
  let fail = 0;
  for (const p of photos) {
    try {
      await mirrorPhoto(handle, p, courseById.get(p.courseId ?? "")?.name);
      ok += 1;
    } catch {
      fail += 1;
    }
  }
  return { ok, fail };
}
