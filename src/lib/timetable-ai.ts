// AI 课表识别：截图/表格文件/文字 → ParsedRow（走原生 CapacitorHttp，免 CORS，APP 线专用）。
// 内置 API 配置（内测小范围分发，仓库保持私有勿公开）。
import { CapacitorHttp } from "@capacitor/core";
import * as XLSX from "xlsx";
import type { ParsedRow } from "./timetable-parse";
import type { Period } from "./types";

// 内测内置配置：从 .env.local 注入（VITE_AI_*，见 .env.example），仓库本身不含 Key；
// APK 构建时打包进去，开源使用者自填即可启用 AI 导入。
const AI_BASE_URL = import.meta.env.VITE_AI_BASE_URL ?? "";
const AI_API_KEY = import.meta.env.VITE_AI_API_KEY ?? "";
const AI_MODEL = import.meta.env.VITE_AI_MODEL ?? "";

function aiConfigured(): boolean {
  return !AI_BASE_URL.includes("REPLACE_ME") && !AI_API_KEY.includes("REPLACE_ME") && !AI_MODEL.includes("REPLACE_ME");
}

/** HTMLImageElement 兜底解码（部分安卓 WebView 的 createImageBitmap 对相册文件报
 * "The source image could not be decoded"，img 元件路径兼容性最老牌；现代浏览器默认按 EXIF 转正） */
function decodeViaImgElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("img decode failed"));
    };
    img.src = url;
  });
}

function blobToRawDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("读取图片失败"));
    r.readAsDataURL(blob);
  });
}

function canvasToDataUrl(
  src: ImageBitmap | HTMLImageElement,
  w: number,
  h: number,
  maxEdge: number,
): string | null {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")?.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** 截图压到长边 1280 再传（教务课表截图够清晰，控 token 与流量）；
 * 三层解码兜底：createImageBitmap → <img> → 原样 base64（不压缩但保功能）。
 * 必须在选图后立即调用——picker 给的临时授权 URI 延迟读取会 NotReadableError */
export async function imageToDataUrl(blob: Blob, maxEdge = 1280): Promise<string> {
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const out = canvasToDataUrl(bmp, bmp.width, bmp.height, maxEdge);
    bmp.close?.();
    if (out) return out;
  } catch {
    // 走 img 元件兜底
  }
  try {
    const img = await decodeViaImgElement(blob);
    const out = canvasToDataUrl(img, img.naturalWidth, img.naturalHeight, maxEdge);
    if (out) return out;
  } catch {
    // 最后原样上传
  }
  return blobToRawDataUrl(blob);
}

function systemPrompt(periods: Period[]): string {
  const periodLines = periods
    .map((p, i) => `第${i * 2 + 1}-${i * 2 + 2}节(大节${i}): ${Math.floor(p.startMin / 60)}:${String(p.startMin % 60).padStart(2, "0")}~${Math.floor(p.endMin / 60)}:${String(p.endMin % 60).padStart(2, "0")}`)
    .join("\n");
  return `你是课表结构化助手。用户会给大学课表，形式可能是：截图、表格文本（CSV，来自教务系统导出的 Excel）、或普通文字描述——三种输入统一解析成 JSON 数组，每个元素格式：
{"name":"课程名","teacher":"教师名或空字符串","weekday":1到7的数字(1=周一,7=周日),"p0":大节起始索引,"p1":大节结束索引,"weeks":[1,2,3...]}
规则：
- 本校作息（一天${periods.length}个大节，两个小节为一个大节）：
${periodLines}
- 小节号换算大节索引：第1-2节=大节0，第3-4节=大节1，第5-6节=大节2，以此类推；"第3节"单独一节时也是大节1
- 表格文本里的表头（星期/节次/周次等）用来定位行列，本身不是课程；坐标布局或逐行清单布局都要能读
- weeks 是上课周次数组(1-30)："1-16周"→[1,2,...,16]；"单周"→所有奇数周；"双周"→所有偶数周；没写周次→[1..16]
- 一个格子里有多门课（不同周次）拆成多条；同一门课的多个时段也是多条
- 忽略"开学第一周""上课周次"等表头说明文字
- 只输出 JSON 数组本身，不要 markdown 围栏、不要任何解释`;
}

/** Excel/表格文件 → CSV 文本（SheetJS 读原始单元格，不挑格式；交给 AI 理解任意布局） */
export function workbookToText(data: ArrayBuffer): string {
  const wb = XLSX.read(data, { type: "array" });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false });
    if (csv.trim()) parts.push(`【工作表：${name}】\n${csv}`);
  }
  return parts.join("\n\n");
}

/** 从 AI 回复里剥出 JSON 数组（容忍围栏和前后废话） */
function extractRows(text: string): unknown[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error("AI 没有返回可识别的课表，换个更清晰的截图试试");
  const parsed = JSON.parse(m[0]) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("AI 没认出任何课程，换张完整的课表截图试试");
  }
  return parsed;
}

function toRow(raw: unknown, periods: Period[]): ParsedRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name) return null;
  const weekday = Math.min(7, Math.max(1, Number(r.weekday) || 1));
  const maxIdx = periods.length - 1;
  let p0 = Math.min(maxIdx, Math.max(0, Number(r.p0) || 0));
  let p1 = Math.min(maxIdx, Math.max(0, Number(r.p1) || 0));
  if (p1 < p0) [p0, p1] = [p1, p0];
  const weeks = (Array.isArray(r.weeks) ? r.weeks : [])
    .map((w) => Number(w))
    .filter((w) => Number.isInteger(w) && w >= 1 && w <= 30);
  return {
    name,
    teacher: typeof r.teacher === "string" && r.teacher.trim() ? r.teacher.trim() : undefined,
    weekday,
    p0,
    p1,
    weeks: weeks.length > 0 ? [...new Set(weeks)].sort((a, b) => a - b) : Array.from({ length: 16 }, (_, i) => i + 1),
    raw: JSON.stringify(raw),
  };
}

async function chat(periods: Period[], userContent: unknown[]): Promise<string> {
  let res;
  try {
    res = await CapacitorHttp.post({
      url: `${AI_BASE_URL}/chat/completions`,
      headers: { Authorization: `Bearer ${AI_API_KEY}`, "Content-Type": "application/json" },
      data: {
        model: AI_MODEL,
        messages: [
          { role: "system", content: systemPrompt(periods) },
          { role: "user", content: userContent },
        ],
        temperature: 0,
      },
      connectTimeout: 30000,
      readTimeout: 300000, // 思考型模型出结果慢（复杂课表实测 2 分钟+），放宽到 5 分钟
    });
  } catch (e) {
    // CapacitorHttp 非 2xx / 断网会 reject，把真实原因带给用户而不是笼统一句失败
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`AI 接口请求失败：${msg.slice(0, 120)}`);
  }
  // 兼容个别网关 Content-Type 不规范导致 CapacitorHttp 不自动解析的情况
  const body =
    typeof res.data === "string" ? (JSON.parse(res.data) as ChatResponse) : (res.data as ChatResponse);
  // 兼容思考模型：content 为空时从 reasoning_content 里找 JSON（extractRows 本就按正则抓取）
  const msg = body.choices?.[0]?.message;
  const text = msg?.content?.trim() || msg?.reasoning_content?.trim();
  if (!text) throw new Error("AI 没有返回内容，稍后再试一次");
  return text;
}

type ChatResponse = {
  choices?: { message?: { content?: string; reasoning_content?: string } }[];
  error?: { message?: string };
};

/**
 * AI 识别课表：截图（可多张，已转 dataURL——选图瞬间读取，避开临时授权失效）或一段文字 → ParsedRow[]。
 * 输出直接进既有 TimetablePreview 预览 → applyTimetable 导入链路。
 */
export async function aiParseTimetable(
  input: { imageDataUrls: string[]; text: string },
  periods: Period[],
): Promise<ParsedRow[]> {
  if (!aiConfigured()) {
    throw new Error("AI 还没有配置（开发者内测占位），联系开发者更新");
  }
  const parts: unknown[] = [];
  for (const url of input.imageDataUrls) {
    parts.push({ type: "image_url", image_url: { url } });
  }
  const instruction = "把这份课表解析成 JSON 数组";
  if (input.text.trim()) parts.push({ type: "text", text: `${instruction}：${input.text.trim()}` });
  else if (parts.length === 0) throw new Error("先选一张课表截图，或粘贴一段课表文字");
  else parts.push({ type: "text", text: instruction });

  const text = await chat(periods, parts);
  const rows = extractRows(text)
    .map((raw) => toRow(raw, periods))
    .filter((r): r is ParsedRow => r !== null);
  if (rows.length === 0) throw new Error("AI 没认出任何课程，换张更完整的课表截图试试");
  // 多张截图合并去重：同名同星期同节次视为同一时段
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.name}|${r.weekday}|${r.p0}|${r.p1}|${r.weeks.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
