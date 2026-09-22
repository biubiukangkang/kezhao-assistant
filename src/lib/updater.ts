// 应用内检查更新：GitHub Releases 托管 version.json + APK，覆盖安装数据保留。
import { isNativeApp } from "./native";

// 本仓库 Release 的固定下载地址（latest/download，发新版不用改 APP）
const UPDATE_MANIFEST_URL = "https://github.com/biubiukangkang/kezhao-assistant/releases/latest/download/version.json";

export type UpdateInfo = {
  versionName: string;
  versionCode: number;
  /** 更新说明（一行一条） */
  notes: string[];
  apkUrl: string;
};

/** 语义化比较：remote > local 才提示 */
function isNewer(remote: string, local: string): boolean {
  const a = remote.split(".").map(Number);
  const b = local.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

/** 当前 APP 版本（versionName，如 "1.4"）；网页端返回 null */
export async function currentVersion(): Promise<string | null> {
  if (!isNativeApp()) return null;
  const { App } = await import("@capacitor/app");
  const info = await App.getInfo();
  return info.version ?? null;
}

/**
 * 检查更新：manifest 拉不到/不需要更新都返回 null（静默）。
 * 只在原生 APP 有意义。
 */
export async function checkUpdate(): Promise<UpdateInfo | null> {
  if (!isNativeApp()) return null;
  const local = await currentVersion();
  if (!local) return null;
  try {
    const res = await fetch(UPDATE_MANIFEST_URL, { cache: "no-store" });
    if (!res.ok) return null;
    const m = (await res.json()) as UpdateInfo;
    if (typeof m.versionName !== "string" || typeof m.apkUrl !== "string") return null;
    return isNewer(m.versionName, local) ? m : null;
  } catch {
    return null; // 无网/地址未配置：静默
  }
}

/** 打开系统浏览器下载 APK（下载完在通知栏点开，直接覆盖安装） */
export async function openUpdateDownload(url: string): Promise<void> {
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url });
}
