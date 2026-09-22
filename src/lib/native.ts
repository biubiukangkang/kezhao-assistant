// 原生 APP（Capacitor）能力适配层：安卓端相册写入、备份分享、自动存相册开关。
// 插件全部走动态 import 且只在 isNativeApp() 分支里调用，网页端构建不加载任何原生逻辑。
import { Capacitor, registerPlugin } from "@capacitor/core";
import { toast } from "sonner";
import { getMetaValue, putMetaValue } from "./db";

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/** backButton 注册所需的最小路由形状（避免拉入整个路由树泛型） */
type BackButtonRouter = {
  state: { location: { pathname: string } };
  history: { canGoBack: () => boolean; back: () => void };
  navigate: (opts: { to: string }) => void;
};

/**
 * 状态栏避让（安卓 15+/targetSdk 35+ 强制 edge-to-edge，内容会顶进状态栏后面；
 * 而 CSS env(safe-area-inset-top) 在安卓 WebView 恒为 0，靠 CSS 让不出来）。
 * 学习国民 APP 的做法：原生层把 WebView 布局到状态栏下方（overlay=false），
 * 状态栏背景与图标色跟随系统深浅色。
 */
export async function setupStatusBar(dark: boolean): Promise<void> {
  const { StatusBar, Style } = await import("@capacitor/status-bar");
  await StatusBar.setOverlaysWebView({ overlay: false });
  await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
  if (Capacitor.getPlatform() === "android") {
    // 与 styles.css 的 --background（浅色 oklch(1 0 0) / 深色 oklch(0.129…)）保持一致
    await StatusBar.setBackgroundColor({ color: dark ? "#17171e" : "#ffffff" });
  }
}

/**
 * 安卓返回键（微信等国民 APP 惯例）：底部 Tab 根页面 = 双击退出；
 * 子页（相册/拍照/课表编辑）= 逐级返回。Tab 切换不进历史栈（bottom-nav 用 replace）。
 */
export function setupAndroidBackButton(router: BackButtonRouter): void {
  void (async () => {
    const { App } = await import("@capacitor/app");
    const TAB_ROOTS = new Set(["/", "/courses", "/settings"]);
    let lastPress = 0;
    App.addListener("backButton", () => {
      const path = router.state.location.pathname;
      if (TAB_ROOTS.has(path)) {
        const now = Date.now();
        if (now - lastPress < 2000) {
          App.exitApp();
        } else {
          lastPress = now;
          toast("再按一次退出");
        }
      } else if (router.history.canGoBack()) {
        router.history.back();
      } else {
        router.navigate({ to: "/" });
      }
    });
  })();
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
  openFolder(options: { album?: string }): Promise<{ via?: string }>;
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

/**
 * 打开照片存放位置：优先系统文件管理器直达 Pictures/课照助手，
 * 机型不支持时由插件回退打开系统相册。返回实际走的方式供文案区分。
 */
export async function openGalleryFolder(): Promise<"files" | "gallery"> {
  const r = await GalleryStore.openFolder({ album: GALLERY_ALBUM });
  return r.via === "gallery" ? "gallery" : "files";
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
 * （全分辨率、方向已转正、EXIF 拍摄时间保留——插件重写文件后 copyExif 会写回 DateTimeOriginal）。
 * 用户取消返回 null。
 * saveToGallery 必须为 false：开 true 时 DCIM 存原图 + 我们镜像 Pictures/课照助手 存压缩版，
 * 系统相册时间线里同一画面出现两张（实测不可接受）。
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

// ---------- 备份导出（流式写缓存目录 + 系统分享面板） ----------

/**
 * 备份流式落盘：逐块追加写入应用缓存文件（内存占用恒定，几百张照片也不怕），
 * 写完调起系统分享，用户可保存到文件管理器或发送。
 * chunks 由 lib/backup.ts 的 backupChunks() 提供。
 */
export async function shareBackupFile(
  chunks: () => AsyncIterable<string>,
  filename: string,
): Promise<void> {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  let first = true;
  for await (const chunk of chunks()) {
    if (first) {
      await Filesystem.writeFile({ path: filename, data: chunk, directory: Directory.Cache });
      first = false;
    } else {
      await Filesystem.appendFile({ path: filename, data: chunk, directory: Directory.Cache });
    }
  }
  const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
  const { Share } = await import("@capacitor/share");
  await Share.share({ title: filename, files: [uri], dialogTitle: "保存或发送备份" });
}
