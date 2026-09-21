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
}

const GalleryStore = registerPlugin<GalleryStorePlugin>("GalleryStore");

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("读取照片数据失败"));
    r.readAsDataURL(blob);
  });
}

/**
 * 把一张照片写进系统相册（安卓：MediaStore 写公共 Pictures/课照助手/，免权限、卸载不清）。
 * fileNameNoExt 不带扩展名。
 */
export async function savePhotoToGallery(blob: Blob, fileNameNoExt: string): Promise<void> {
  await GalleryStore.savePhoto({
    path: await readAsDataUrl(blob),
    fileName: fileNameNoExt,
    album: GALLERY_ALBUM,
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
