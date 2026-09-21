import {
  clearPhotoFolder,
  getPhotoFolder,
  listCourses,
  listPhotos,
  savePhotoFolder,
} from "./db";
import {
  GALLERY_ALBUM,
  galleryAutoSaveEnabled,
  isNativeApp,
  savePhotoToGallery,
  setGalleryAutoSave,
} from "./native";
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

/** 当前环境是否支持照片同步（原生 APP 恒支持，走系统相册；网页看 File System Access API） */
export function folderSupported(): boolean {
  return isNativeApp() || typeof (window as DirPickerWindow).showDirectoryPicker === "function";
}

/** 开启同步：原生 = 打开自动存相册；网页 = 弹系统文件夹选择器。返回目标名，取消/失败返回 null */
export async function pickFolder(): Promise<string | null> {
  if (isNativeApp()) {
    await setGalleryAutoSave(true);
    return GALLERY_ALBUM;
  }
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
  if (isNativeApp()) {
    return (await galleryAutoSaveEnabled())
      ? { name: GALLERY_ALBUM, permission: "granted" }
      : { name: null, permission: null };
  }
  const handle = await getPhotoFolder();
  if (!handle) return { name: null, permission: null };
  return { name: handle.name, permission: await permissionOf(handle) };
}

/** 页面加载后第一次写入需要用户点一下重新授权（原生无此概念，恒通过） */
export async function regrantFolder(): Promise<boolean> {
  if (isNativeApp()) return true;
  const handle = await getPhotoFolder();
  if (!handle) return false;
  return requestFolderPermission(handle);
}

export async function stopFolderSync(): Promise<void> {
  if (isNativeApp()) {
    await setGalleryAutoSave(false);
    return;
  }
  await clearPhotoFolder();
}

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

/** 同步文件名（含课程名与短 id，同名覆盖幂等）；导出相册时复用 */
export function fileNameFor(p: Photo, courseName?: string): string {  const d = new Date(p.capturedAt);
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

/** 镜像单张（入库后调用）：无文件夹/无权限/未开启时静默跳过 */
export async function mirrorPhotoIfEnabled(p: Photo): Promise<void> {
  try {
    if (isNativeApp()) {
      if (!p.blob || !(await galleryAutoSaveEnabled())) return;
      const courses = await listCourses();
      const courseName = p.courseId ? courses.find((c) => c.id === p.courseId)?.name : null;
      await savePhotoToGallery(p.blob, fileNameFor(p, courseName ?? undefined).replace(/\.jpg$/, ""), courseName);
      return;
    }
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

/** 全量同步：把库里所有照片写进文件夹/相册，返回成功张数 */
export async function syncAllPhotos(): Promise<{ ok: number; fail: number }> {
  const courses = await listCourses();
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const photos = await listPhotos();
  let ok = 0;
  let fail = 0;
  if (isNativeApp()) {
    for (const p of photos) {
      if (!p.blob) continue;
      const courseName = courseById.get(p.courseId ?? "")?.name ?? null;
      try {
        await savePhotoToGallery(
          p.blob,
          fileNameFor(p, courseName ?? undefined).replace(/\.jpg$/, ""),
          courseName,
        );
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    return { ok, fail };
  }
  const handle = await getPhotoFolder();
  if (!handle) throw new Error("还没有选择文件夹");
  if ((await permissionOf(handle)) !== "granted") {
    throw new Error("文件夹授权已过期，请重新授权");
  }
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
