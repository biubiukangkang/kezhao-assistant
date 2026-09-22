// 构建后生成 version.json（与 APK 同目录），连同 APK 一起传 GitHub Release 即完成发版。
// 用法：node scripts/make-version-json.mjs "更新说明第一行|第二行"
import { readFileSync, writeFileSync } from "node:fs";

// 本仓库 Release 的固定下载地址
const RELEASE_BASE = "https://github.com/biubiukangkang/kezhao-assistant/releases/latest/download";

const gradle = readFileSync("android/app/build.gradle", "utf8");
const versionCode = Number(/versionCode (\d+)/.exec(gradle)?.[1]);
const versionName = /versionName "([^"]+)"/.exec(gradle)?.[1];
if (!versionCode || !versionName) {
  console.error("make-version-json: 从 android/app/build.gradle 读不到版本号");
  process.exit(1);
}

const notes = (process.argv[2] ?? "").split("|").filter(Boolean);
const out = {
  versionName,
  versionCode,
  notes,
  apkUrl: `${RELEASE_BASE}/kezhaov${versionName}.apk`,
};
const target = "android/app/build/outputs/apk/release/version.json";
writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
console.log(`make-version-json: ${target} → v${versionName} (code ${versionCode})`);
