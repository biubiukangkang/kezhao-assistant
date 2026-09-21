// 照片出口：原生 APP 直接写系统相册「课照助手」；网页手机端走 Web Share（系统"保存到相册/分享"面板），桌面端逐张下载兜底
import { isNativeApp, savePhotoToGallery } from "./native";
import { fileNameFor } from "./photo-folder";
import type { Photo } from "./types";

const SHARE_BATCH = 10;

function fileName(p: Photo, i: number, total: number): string {
  const d = new Date(p.capturedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const t = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return total > 1 ? `课照-${t}-${i + 1}.jpg` : `课照-${t}.jpg`;
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export type ExportResult = "saved" | "shared" | "downloaded" | "empty";

/** 保存/分享照片：原生写相册，Web Share 可用则分批调起系统面板，否则逐张触发下载 */
export async function exportPhotos(
  photos: Photo[],
  onProgress?: (done: number, total: number) => void,
): Promise<ExportResult> {
  const withBlob = photos.filter((p) => p.blob);
  if (withBlob.length === 0) return "empty";

  if (isNativeApp()) {
    let done = 0;
    for (const p of withBlob) {
      await savePhotoToGallery(p.blob!, fileNameFor(p).replace(/\.jpg$/, ""));
      done += 1;
      onProgress?.(done, withBlob.length);
    }
    return "saved";
  }

  const files = withBlob.map((p, i) => new File([p.blob!], fileName(p, i, withBlob.length), { type: "image/jpeg" }));
  const canShareFiles = typeof navigator.share === "function" && navigator.canShare?.({ files: [files[0]] }) === true;

  if (canShareFiles) {
    let done = 0;
    for (let i = 0; i < files.length; i += SHARE_BATCH) {
      const batch = files.slice(i, i + SHARE_BATCH);
      try {
        await navigator.share({ files: batch, title: withBlob.length > 1 ? `课照助手 · ${batch.length} 张照片` : "课照助手照片" });
      } catch (e) {
        // 用户关掉分享面板：中止后续批次，不算错误
        if (e instanceof DOMException && e.name === "AbortError") {
          onProgress?.(done, withBlob.length);
          return "shared";
        }
        throw e;
      }
      done += batch.length;
      onProgress?.(done, withBlob.length);
    }
    return "shared";
  }

  // 桌面下载兜底
  for (let i = 0; i < withBlob.length; i += 1) {
    downloadBlob(withBlob[i].blob!, fileName(withBlob[i], i, withBlob.length));
    onProgress?.(i + 1, withBlob.length);
  }
  return "downloaded";
}
