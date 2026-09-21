// 原生 APP（Capacitor）能力适配层：安卓端相册写入、备份分享、自动存相册开关。
// 插件全部走动态 import 且只在 isNativeApp() 分支里调用，网页端构建不加载任何原生逻辑。
import { Capacitor, registerPlugin } from "@capacitor/core";
import { getMetaValue, putMetaValue } from "./db";

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/** 系统相册里的相册名（安卓实际落在 Pictures/课照助手/） */
export const GALLERY_ALBUM = "课照助手";

// ---------- 自动存入相册开关（meta KV，默认开启） ----------

const GALLERY_KEY = "galleryAutoSave";

export async function galleryAutoSaveEnabled(): Promise<boolean> {
  return (await getMetaValue<boolean>(GALLERY_KEY)) !== false;
}

export async function setGalleryAutoSave(on: boolean): Promise<void> {
  await putMetaValue(GALLERY_KEY, on);
}

// ---------- 相册写入（本地 GalleryStore 插件，MediaStore 直写公共 Pictures） ----------

interface GalleryStorePlugin {
  savePhoto(options: { path: string; fileName: string; album?: string }): Promise<{ filePath: string }>;
  deleteAlbumFiles(options: { album?: string }): Promise<{ deleted: number }>;
  openFolder(options: { album?: string }): Promise<void>;
}

const GalleryStore = registerPlugin<GalleryStorePlugin>("GalleryStore");

/** 子文件夹名：课程名去掉文件系统非法字符；没有课程归「待分类」 */
function subjectFolder(courseName: string | null | undefined): string {
  const cleaned = (courseName ?? "").replace(/[\\/:*?"<>|]/g, "_").trim();
  return cleaned || "待分类";
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("读取照片数据失败"));
    r.readAsDataURL(blob);
  });
}

/**
 * 把一张照片写进系统相册（安卓：MediaStore 写 Pictures/课照助手/<课程名>/，免权限、卸载不清）。
 * fileNameNoExt 不带扩展名；同名重复写入前插件先删旧记录，天然幂等。
 */
export async function savePhotoToGallery(
  blob: Blob,
  fileNameNoExt: string,
  courseName?: string | null,
): Promise<void> {
  await GalleryStore.savePhoto({
    path: await readAsDataUrl(blob),
    fileName: fileNameNoExt,
    album: `${GALLERY_ALBUM}/${subjectFolder(courseName)}`,
  });
}

// ---------- 文件夹入口与结构迁移 ----------

/** 用系统文件管理器打开 Pictures/课照助手 */
export async function openGalleryFolder(): Promise<void> {
  await GalleryStore.openFolder({ album: GALLERY_ALBUM });
}

const ALBUM_STRUCTURE_KEY = "albumStructure";
const ALBUM_STRUCTURE_V2 = 2; // 2 = 按科目子文件夹（1 = 旧的平铺布局）

/**
 * 旧镜像布局 → 科目子文件夹迁移：删掉「课照助手」顶层的旧镜像文件，
 * 再从主库全量按新结构重写（主库是事实源，重跑幂等不重复）。
 */
export async function migrateAlbumStructure(
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: number; fail: number }> {
  await GalleryStore.deleteAlbumFiles({ album: GALLERY_ALBUM });
  const { listPhotos, listCourses } = await import("./db");
  const { fileNameFor } = await import("./photo-folder");
  const [photos, courses] = await Promise.all([listPhotos(), listCourses()]);
  const byId = new Map(courses.map((c) => [c.id, c.name]));
  let ok = 0;
  let fail = 0;
  let done = 0;
  for (const p of photos) {
    if (!p.blob) continue;
    const courseName = p.courseId ? byId.get(p.courseId) ?? null : null;
    try {
      await savePhotoToGallery(p.blob, fileNameFor(p, courseName ?? undefined).replace(/\.jpg$/, ""), courseName);
      ok += 1;
    } catch {
      fail += 1;
    }
    done += 1;
    onProgress?.(done, photos.length);
  }
  await putMetaValue(ALBUM_STRUCTURE_KEY, ALBUM_STRUCTURE_V2);
  return { ok, fail };
}

export async function albumStructureUpToDate(): Promise<boolean> {
  return (await getMetaValue<number>(ALBUM_STRUCTURE_KEY)) === ALBUM_STRUCTURE_V2;
}

// ---------- 系统相机（@capacitor/camera） ----------

/**
 * 调系统相机 App 拍一张：原生画质/对焦/变焦，拍完返回可直接入库的 File
 * （全分辨率、方向已转正、EXIF 拍摄时间保留）。用户取消返回 null。
 */
export async function takePhotoWithSystemCamera(): Promise<File | null> {
  const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
  let photo;
  try {
    photo = await Camera.getPhoto({
      resultType: CameraResultType.Uri,
      source: CameraSource.Camera,
      quality: 100,
      correctOrientation: true,
      saveToGallery: false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(msg)) return null;
    throw e;
  }
  if (!photo.webPath) throw new Error("相机没有返回照片");
  const res = await fetch(photo.webPath);
  const blob = await res.blob();
  return new File([blob], `课照-${Date.now()}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

// ---------- 备份导出（写缓存目录 + 系统分享面板） ----------

function readAsBase64(blob: Blob): Promise<string> {
  return readAsDataUrl(blob).then((s) => s.slice(s.indexOf(",") + 1));
}

/** 备份 JSON 写入应用缓存后调起系统分享，用户可保存到文件管理器或发送 */
export async function shareBackupFile(blob: Blob, filename: string): Promise<void> {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: await readAsBase64(blob),
    directory: Directory.Cache,
  });
  const { Share } = await import("@capacitor/share");
  await Share.share({ title: filename, files: [uri], dialogTitle: "保存或发送备份" });
}
