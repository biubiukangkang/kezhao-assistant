// 应用内检查更新：GitHub Releases 托管 version.json + APK，覆盖安装数据保留。
import { downloadAndInstallApk, isNativeApp } from "./native";

// 多源依次尝试：WebView fetch 会被 CORS 拦（GitHub 资产无跨域头）且国内直连不稳，
// 检查与下载全走原生层。TODO(chen): gitee 国内镜像建好后放首位。
const MANIFEST_SOURCES = [
  "https://github.com/biubiukangkang/kezhao-assistant/releases/latest/download/version.json",
];

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

/** 拉取更新清单：CapacitorHttp 原生请求（免 CORS），多源依次尝试，全失败返回 null（静默） */
async function fetchManifest(): Promise<UpdateInfo | null> {
  const { CapacitorHttp } = await import("@capacitor/core");
  for (const url of MANIFEST_SOURCES) {
    try {
      const res = await CapacitorHttp.get({
        url,
        connectTimeout: 8000,
        readTimeout: 15000,
      });
      // 资产域回的是 octet-stream，data 可能是字符串
      const m =
        typeof res.data === "string"
          ? (JSON.parse(res.data) as UpdateInfo)
          : (res.data as UpdateInfo);
      if (m && typeof m.versionName === "string" && typeof m.apkUrl === "string") {
        return m;
      }
    } catch {
      // 试下一个源
    }
  }
  return null;
}

/**
 * 检查更新：manifest 拉不到/不需要更新都返回 null（静默）。
 * 只在原生 APP 有意义。
 */
export async function checkUpdate(): Promise<UpdateInfo | null> {
  if (!isNativeApp()) return null;
  const local = await currentVersion();
  if (!local) return null;
  const m = await fetchManifest();
  if (!m) return null;
  return isNewer(m.versionName, local) ? m : null;
}

/** 应用内下载并安装：系统下载器（通知栏进度）→ 完成自动弹安装器；失败兜底浏览器 */
export async function openUpdateDownload(url: string): Promise<void> {
  try {
    await downloadAndInstallApk(url);
  } catch {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
  }
}
