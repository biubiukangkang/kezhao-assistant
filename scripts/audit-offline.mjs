#!/usr/bin/env node
// scripts/audit-offline.mjs —— 离线审计（实施方案 §9.9）
// 1) dist/assets/*.js：禁用网络 API（XMLHttpRequest/WebSocket/EventSource/sendBeacon）；
//    URL 仅允许白名单域名（React 产物的 w3.org 命名空间、react.dev 文档链等）
// 2) src 全目录：fetch( 只允许出现在 lib/backup.ts、lib/native.ts（均为本地 dataURL/本地文件读取）
// 3) 有 aapt2 时：APK 不得含 INTERNET / REQUEST_INSTALL_PACKAGES / 存储权限
// 全部通过输出 PASS 退出 0；任一失败打印命中详情（含上下文取证）退出 1
// 豁免纪律：URL_EXEMPT 新增豁免必须附包名+理由+取证，不得为消报而豁免

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const rel = (p) => relative(ROOT, p).replaceAll("\\", "/");

const NET_API = /\b(XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/g;
const URL_RE = /https?:\/\/[^\s"'`)]+/g;
const URL_ALLOW = [
  "www.w3.org",
  "react.dev",
  "reactjs.org",
  "github.com/facebook",
  "tailwindcss.com",
];

// 依赖包体内惰性字符串豁免：match 为精确串或前缀（url 等于 match 或以 match 开头即命中）。
// 全部项均经取证：XML 命名空间标识符 / 错误消息文本，无任何网络调用代码路径
// （dist 网络 API 零命中佐证）。命中打印 [豁免] 日志，不静默；未覆盖的白名单外 URL 照旧 FAIL。
// 豁免纪律：新增豁免必须附包名+理由+取证，不得为消报而豁免。
const URL_EXEMPT = [
  { match: "http://schemas.openxmlformats.org/", pkg: "xlsx", reason: "OOXML 命名空间标识符，解析时字符串匹配" },
  { match: "http://purl.oclc.org/", pkg: "xlsx", reason: "DrawingML 命名空间标识符" },
  { match: "http://schemas.microsoft.com/", pkg: "xlsx", reason: "OOXML 扩展命名空间标识符" },
  { match: "http://sheetjs.openxmlformats.org/", pkg: "xlsx", reason: "SheetJS 自定义命名空间标识符" },
  { match: "http://ns.adobe.com/", pkg: "exifr", reason: "XMP 命名空间标识符，字符串比较" },
  { match: "https://github.com/MikeKovarik/exifr", pkg: "exifr", reason: "报 issue 错误消息文本" },
  { match: "https://capacitorjs.com/docs/web/pwa-elements", pkg: "@capacitor/camera", reason: "Web 分支加载失败错误消息里的文档链接，Android 走原生插件不执行" },
  { match: "http://localhost", pkg: "@tanstack/router-core", reason: "origin 为 \"null\" 时的兜底字符串，非请求目标" },
];

function matchExempt(url) {
  return URL_EXEMPT.find((e) => url === e.match || url.startsWith(e.match));
}

// 本地读取 fetch 的白名单（src 相对路径）
const FETCH_ALLOW = new Set(["src/lib/backup.ts", "src/lib/native.ts"]);

// APK 禁止出现的权限（网络 / 安装包 / 存储）
const FORBIDDEN_PERMS = [
  "android.permission.INTERNET",
  "android.permission.REQUEST_INSTALL_PACKAGES",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_MEDIA_AUDIO",
  "android.permission.MANAGE_EXTERNAL_STORAGE",
];

const AAPT2 = "C:/Users/25922/AppData/Local/Android/Sdk/build-tools/36.1.0/aapt2.exe";
const APK = join(ROOT, "android/app/build/outputs/apk/debug/app-debug.apk");

const failures = [];

/** 取命中处上下文，供误报取证 */
function context(code, index, keyword) {
  const start = Math.max(0, index - 60);
  const end = Math.min(code.length, index + keyword.length + 60);
  return code.slice(start, end).replaceAll("\n", "\\n");
}

function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

// ---------- 1) dist/assets/*.js ----------
const assetDir = join(ROOT, "dist", "assets");
const jsFiles = existsSync(assetDir)
  ? readdirSync(assetDir).filter((f) => f.endsWith(".js")).map((f) => join(assetDir, f))
  : [];

if (jsFiles.length === 0) {
  failures.push(`[产物缺失] dist/assets/*.js 为空，先执行 npm run build`);
}

for (const file of jsFiles) {
  const code = readFileSync(file, "utf8");
  const r = rel(file);

  for (const m of code.matchAll(NET_API)) {
    failures.push(`[网络API] ${r}: ${m[0]}\n    上下文: …${context(code, m.index, m[0])}…`);
  }

  const badUrls = new Set();
  for (const m of code.matchAll(URL_RE)) {
    const url = m[0];
    if (!URL_ALLOW.some((w) => url.includes(w))) badUrls.add(url);
  }
  for (const url of badUrls) {
    const hit = matchExempt(url);
    if (hit) {
      const via = url === hit.match ? "" : `（前缀 ${hit.match}）`;
      console.log(`[豁免] ${hit.pkg} ${url}${via} — ${hit.reason}`);
      continue;
    }
    const idx = code.indexOf(url);
    failures.push(`[白名单外URL] ${r}: ${url}\n    上下文: …${context(code, idx, url)}…`);
  }
}

// ---------- 2) src 全目录 fetch( ----------
for (const file of walk(join(ROOT, "src"), [".ts", ".tsx"])) {
  const r = rel(file);
  if (FETCH_ALLOW.has(r)) continue;
  const code = readFileSync(file, "utf8");
  const lines = code.split("\n");
  lines.forEach((line, i) => {
    if (line.includes("fetch(")) {
      failures.push(`[越权fetch] ${r}:${i + 1}: ${line.trim()}`);
    }
  });
}

// ---------- 3) APK 权限（有 aapt2 才查） ----------
if (existsSync(AAPT2)) {
  if (!existsSync(APK)) {
    console.log("[audit] APK 不存在，先执行 npm run app:debug 构建…");
    if (!process.env.JAVA_HOME && existsSync("C:\\Java\\jdk-21")) {
      process.env.JAVA_HOME = "C:\\Java\\jdk-21";
    }
    execSync("npm run app:debug", { cwd: ROOT, stdio: "inherit", env: process.env });
  }
  if (existsSync(APK)) {
    const out = execSync(`"${AAPT2}" dump permissions "${APK}"`, { encoding: "utf8" });
    const perms = [...out.matchAll(/name='([^']+)'/g)].map((m) => m[1]);
    console.log(`[audit] APK 权限（${rel(APK)}）: ${perms.length ? perms.join(", ") : "(无)"}`);
    for (const p of perms) {
      if (FORBIDDEN_PERMS.includes(p)) {
        failures.push(`[APK权限] 含禁止权限 ${p}`);
      }
    }
  } else {
    failures.push(`[APK缺失] 构建后仍未找到 ${rel(APK)}`);
  }
} else {
  console.log("[audit] 未找到 aapt2，跳过 APK 权限检查");
}

// ---------- 结果 ----------
if (failures.length > 0) {
  console.error(`FAIL（${failures.length} 项）`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log("PASS");
