// KZS1 课表文本解析器（AI 导入第 3 步：粘贴结果 → 结构化课表行）。
// 自包含模块：不 import 项目内其他文件；作息表（大节）由调用方以 periods 参数传入。
//
// 四通道解析，取「识别成功数（ok+warn）」最多者；平局按优先级 JSON > 表格 > KZS1 行式 > 自由文本：
//   ① JSON：剥代码围栏/前后废话，抓 JSON 数组；兼容旧契约 {name,teacher,weekday,p0,p1,weeks} 与中文字段别名
//   ② 表格模式：含 Tab/竖线的行（含 Markdown 表），表头行列映射，数据行按映射取值
//   ③ KZS1 行式：`课程名 | 星期 | 节次 | 周次 | 教师 | 教室`，逐行按 6 列语义解析
//   ④ 自由文本：token 剥离（星期/节次/周次表达式），剩余文本猜课程名

export type Period = { startMin: number; endMin: number };

export type KzsRow = {
  name: string; // 课程名
  weekday: number; // 1=周一 … 7=周日
  p0: number; // 大节起始索引（0 起，对应 periods[p0]）
  p1: number; // 大节结束索引（含）
  weeks: number[]; // 上课周次（升序去重）
  teacher?: string; // 时段级教师，缺省回退 Course.teacher
  room?: string; // 教室 → ScheduleSlot.room
};

export type KzsFailedLine = {
  lineNo: number; // 原文行号（1 起；JSON 通道为元素序号）
  raw: string;
  reason: string;
  suggestion?: string;
};

export type KzsParseResult = {
  ok: KzsRow[];
  warn: (KzsRow & { issue: string })[];
  failed: KzsFailedLine[];
};

export type ParseKzsOptions = {
  periods: Period[]; // 用户作息表（大节），决定节数上限与时间反查
  defaultWeeks?: number; // 缺周次时补全 1..defaultWeeks，默认 16
};

const DEFAULT_WEEKS = 16;
const TIME_TOLERANCE_MIN = 15;
// 弱分隔符拆分时保护数字间的逗号（周次 1,3,5 / 节次 5,6），用私用区字符占位避免控制字符正则
const COMMA_GUARD = String.fromCharCode(0xe000);

type Field = "name" | "weekday" | "period" | "weeks" | "teacher" | "room";
const DEFAULT_ORDER: Field[] = ["name", "weekday", "period", "weeks", "teacher", "room"];

type BuildCtx = { periods: Period[]; defaultWeeks: number };

type ChannelResult = {
  ok: KzsRow[];
  warn: (KzsRow & { issue: string })[];
  failed: KzsFailedLine[];
};

type BuildResult =
  | { kind: "ok"; row: KzsRow; issues: string[] }
  | { kind: "fail"; reason: string; suggestion?: string };

function clampInt(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ---------- 单元格拆分 ----------

/** 按分隔符拆列（保留空列占位，因为提示词约定「教师/教室留空但竖线保留」）；
 *  先按竖线/Tab 拆，再在片段内按 ≥2 空格拆（`|  |` 只产生一个空列，不会错位）；
 *  不足 4 列时再试弱分隔符中英文逗号 */
function splitCells(raw: string): string[] {
  const s = raw.trim().replace(/^[|｜]\s*/, "").replace(/\s*[|｜]$/, "");
  const cells: string[] = [];
  for (const seg of s.split(/[|｜\t]/)) {
    const t = seg.trim();
    if (/\s{2,}/.test(t)) cells.push(...t.split(/\s{2,}/).map((c) => c.trim()));
    else cells.push(t);
  }
  if (cells.length >= 4) return cells;
  // 弱分隔符：中英文逗号；数字间的逗号先保护（周次 1,3,5 / 节次 5,6）
  return cells.flatMap((c) => {
    const guarded = c.replace(/(\d)\s*,\s*(?=\d)/g, `$1${COMMA_GUARD}`);
    return guarded.split(/,|，/).map((x) => x.replaceAll(COMMA_GUARD, ",").trim());
  });
}

/** >6 列时尾部并入教室（教室名可能含分隔符） */
function normalizeCells(cells: string[]): string[] {
  if (cells.length > 6) return [...cells.slice(0, 5), cells.slice(5).join(" ")];
  return cells;
}

// ---------- 字段解析 ----------

const CN_WD: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

/** 周一/星期一/周1/礼拜天/星期日/1-7 → 1-7；无法识别返回 null */
function parseWeekdayCell(s: string): number | null {
  const t = s.trim().replace(/\s+/g, "");
  const m = t.match(/^(?:星期几|星期|周|礼拜)?([一二三四五六日天]|[1-7])$/);
  if (!m) return null;
  const g = m[1];
  if (g in CN_WD) return CN_WD[g];
  return /^[1-7]$/.test(g) ? Number(g) : null;
}

/** 节次单元格 → 大节索引区间。
 *  支持 `1-2节` `3~4` `第3节` `5,6节` 与时间 `08:00-09:35`（按作息表 ±15min 反查，可跨午休）。
 *  p = floor((节-1)/2)，clamp 到 [0, periods.length-1]，越界时 overflow=true */
function parsePeriodCell(s: string, periods: Period[]): { p0: number; p1: number; overflow: boolean } | null {
  const t = s.trim();
  if (!t || periods.length === 0) return null;
  const tm = t.match(/(\d{1,2}):(\d{2})\s*[-~—～]\s*(\d{1,2}):(\d{2})/);
  if (tm) {
    const startMin = Number(tm[1]) * 60 + Number(tm[2]);
    const endMin = Number(tm[3]) * 60 + Number(tm[4]);
    const i = periods.findIndex((p) => Math.abs(p.startMin - startMin) <= TIME_TOLERANCE_MIN);
    const j = periods.findIndex((p) => Math.abs(p.endMin - endMin) <= TIME_TOLERANCE_MIN);
    if (i === -1 && j === -1) return null;
    const a = i === -1 ? j : i;
    const b = j === -1 ? i : j;
    return { p0: Math.min(a, b), p1: Math.max(a, b), overflow: false };
  }
  const nm = t.match(/(\d+)/);
  if (!nm) return null;
  const lo = Number(nm[1]);
  const m2 = t.match(/(\d+)\s*[-~—～,，、]\s*(\d+)/);
  const hi = m2 ? Number(m2[2]) : lo;
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  const maxIdx = periods.length - 1;
  const p0raw = Math.floor((a - 1) / 2);
  const p1raw = Math.floor((b - 1) / 2);
  return {
    p0: clampInt(p0raw, 0, maxIdx),
    p1: clampInt(p1raw, 0, maxIdx),
    overflow: p0raw < 0 || p1raw > maxIdx,
  };
}

function filterOddEven(weeks: number[], odd: boolean, even: boolean): number[] {
  if (!odd && !even) return weeks;
  return weeks.filter((w) => (odd ? w % 2 === 1 : true) && (even ? w % 2 === 0 : true));
}

/** 周次单元格 → 周次数组；无法识别返回 null（由调用方补默认 + warn）。
 *  支持 `1-16周` `1-16` `单周` `双周` `1-16周(单)` `1,3,5-9周` `第1周` */
function parseWeeksCell(s: string, defaultWeeks: number): number[] | null {
  const t = s.trim();
  if (!t) return null;
  const odd = /[（(]\s*单\s*[）)]|单\s*周|周\s*单/.test(t);
  const even = /[（(]\s*双\s*[）)]|双\s*周|周\s*双/.test(t);
  const body = t.replace(/[（(][^）)]*[）)]/g, " ").replace(/第?\s*[单双]\s*周|周\s*[单双]/g, " ");
  const m = body.match(/\d+(?:\s*[-~—～,，]\s*\d+)*/);
  const upper = Math.max(30, defaultWeeks);
  if (!m) {
    if (!odd && !even) return null;
    return filterOddEven(
      Array.from({ length: defaultWeeks }, (_, i) => i + 1),
      odd,
      even,
    );
  }
  const set = new Set<number>();
  for (const tk of m[0].split(/\s*[,，]\s*/)) {
    const rm = tk.match(/^(\d+)\s*[-~—～]\s*(\d+)$/);
    if (rm) {
      for (let w = Math.min(Number(rm[1]), Number(rm[2])); w <= Math.min(Math.max(Number(rm[1]), Number(rm[2])), upper); w++) {
        if (w >= 1) set.add(w);
      }
    } else if (/^\d+$/.test(tk)) {
      const w = Number(tk);
      if (w >= 1 && w <= upper) set.add(w);
    }
  }
  if (set.size === 0) return null;
  return filterOddEven([...set].sort((x, y) => x - y), odd, even);
}

// ---------- 表头识别 ----------

const HEADER_RULES: [RegExp, Field][] = [
  [/课程|课名|科目|名称/, "name"],
  [/星期|周几|礼拜/, "weekday"],
  [/节次|上课时间|时间|^节$/, "period"],
  [/周次|上课周次|周数/, "weeks"],
  [/教师|老师/, "teacher"],
  [/教室|地点|课室/, "room"],
];

function headerFieldOf(cell: string): Field | null {
  const c = cell.trim();
  // 含数字的单元格是数据（如 课程0、1-16周、50302），不是表头
  if (!c || /\d/.test(c)) return null;
  for (const [re, f] of HEADER_RULES) if (re.test(c)) return f;
  return null;
}

/** 表头行：任两列命中字段词（「课程/名称」「星期/周几」「节次/上课时间」…），
 *  且整行不含数字——数据行的节次/周次必含数字，避免「课程设计 | 星期三 | 1-2节 | …」
 *  这类课程名恰含关键词的数据行被误判为表头而丢弃 */
function isHeaderCells(cells: string[]): boolean {
  if (cells.some((c) => /\d/.test(c))) return false;
  return cells.filter((c) => headerFieldOf(c) !== null).length >= 2;
}

/** 表头行列映射；非表头行返回 null */
function headerColumnMap(cells: string[]): Partial<Record<Field, number>> | null {
  if (!isHeaderCells(cells)) return null;
  const map: Partial<Record<Field, number>> = {};
  cells.forEach((c, i) => {
    const f = headerFieldOf(c);
    if (f && map[f] === undefined) map[f] = i;
  });
  return map;
}

/** Markdown 分隔行（| --- | :-: |） */
function isSeparatorRow(raw: string): boolean {
  const s = raw.trim();
  return s.includes("-") && /^[\s|｜:-]+$/.test(s);
}

// ---------- 行 → KzsRow ----------

function buildRow(cells: string[], map: Partial<Record<Field, number>> | null, ctx: BuildCtx): BuildResult {
  const cs = normalizeCells(cells);
  if (cs.length < 4) {
    return {
      kind: "fail",
      reason: `只有 ${cs.length} 列，不足 4 列`,
      suggestion: "按「课程名 | 星期 | 节次 | 周次 | 教师 | 教室」补全（竖线保留）",
    };
  }
  const get = (f: Field): string => {
    const idx = map ? map[f] : DEFAULT_ORDER.indexOf(f);
    return idx !== undefined && idx >= 0 && idx < cs.length ? cs[idx].trim() : "";
  };
  const name = get("name");
  if (!name) return { kind: "fail", reason: "课程名为空", suggestion: "第一列填课程名" };
  const wdRaw = get("weekday");
  const weekday = parseWeekdayCell(wdRaw);
  if (weekday === null) {
    return { kind: "fail", reason: `星期无法识别：「${wdRaw}」`, suggestion: "星期写成 周一~周日（或 1~7）" };
  }
  const pRaw = get("period");
  const period = parsePeriodCell(pRaw, ctx.periods);
  if (period === null) {
    return { kind: "fail", reason: `节次无法识别：「${pRaw}」`, suggestion: "节次写成 1-2节 / 第3节 / 08:00-09:35" };
  }
  const issues: string[] = [];
  if (period.overflow) {
    issues.push(`节次「${pRaw}」超出作息表范围（共 ${ctx.periods.length} 个大节），已截断为第 ${period.p0 + 1}-${period.p1 + 1} 大节`);
  }
  let weeks = parseWeeksCell(get("weeks"), ctx.defaultWeeks);
  if (weeks === null || weeks.length === 0) {
    weeks = Array.from({ length: ctx.defaultWeeks }, (_, i) => i + 1);
    issues.push(`未写周次，已按 1-${ctx.defaultWeeks} 周处理`);
  }
  const teacher = get("teacher") || undefined;
  const room = get("room") || undefined;
  return {
    kind: "ok",
    issues,
    row: { name, weekday, p0: period.p0, p1: period.p1, weeks, ...(teacher ? { teacher } : {}), ...(room ? { room } : {}) },
  };
}

function pushResult(
  res: BuildResult,
  raw: string,
  lineNo: number,
  out: { ok: KzsRow[]; warn: (KzsRow & { issue: string })[]; failed: KzsFailedLine[] },
): void {
  if (res.kind === "fail") {
    out.failed.push({ lineNo, raw, reason: res.reason, ...(res.suggestion ? { suggestion: res.suggestion } : {}) });
  } else if (res.issues.length > 0) {
    out.warn.push({ ...res.row, issue: res.issues.join("；") });
  } else {
    out.ok.push(res.row);
  }
}

// ---------- 通道 ③：KZS1 行式 ----------

function channelKzs(lines: string[], ctx: BuildCtx): ChannelResult {
  const out: ChannelResult = { ok: [], warn: [], failed: [] };
  lines.forEach((line, i) => {
    const raw = line.trim();
    if (!raw || isSeparatorRow(raw)) return;
    const cells = splitCells(raw);
    if (isHeaderCells(cells)) return; // 表头跳过
    pushResult(buildRow(cells, null, ctx), raw, i + 1, out);
  });
  return out;
}

// ---------- 通道 ②：表格模式 ----------

function channelTable(lines: string[], ctx: BuildCtx): ChannelResult {
  const out: ChannelResult = { ok: [], warn: [], failed: [] };
  let map: Partial<Record<Field, number>> | null = null; // 第一个表头定列映射（分批粘贴不覆盖）
  lines.forEach((line, i) => {
    const raw = line.trim();
    if (!raw || isSeparatorRow(raw)) return;
    if (!/[|｜\t]/.test(raw)) return; // 只收表格行
    const cells = splitCells(raw);
    const hm = headerColumnMap(cells);
    if (hm) {
      if (map === null) map = hm;
      return;
    }
    pushResult(buildRow(cells, map, ctx), raw, i + 1, out);
  });
  return out;
}

// ---------- 通道 ①：JSON ----------

function pickStr(r: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** 剥代码围栏（围栏行换成空行，保持行号不错位） */
function stripCodeFence(text: string): string {
  return text.replace(/```[^\n]*\n?/g, "\n");
}

function rowFromJsonObj(item: unknown, ctx: BuildCtx): BuildResult {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    return { kind: "fail", reason: "不是课程对象" };
  }
  const r = item as Record<string, unknown>;
  const name = pickStr(r, ["name", "course", "title", "课程名", "课程", "课名", "科目"]);
  if (!name) return { kind: "fail", reason: "缺少课程名", suggestion: "补 name / 课程名 字段" };
  const issues: string[] = [];

  // 星期：数字（旧契约 weekday）或中文
  const wdRaw = pickStr(r, ["weekday", "day", "星期", "周几"]);
  let weekday = wdRaw !== null ? parseWeekdayCell(wdRaw) : null;
  if (weekday === null && wdRaw !== null && /^\d+$/.test(wdRaw)) {
    weekday = clampInt(Number(wdRaw), 1, 7);
    issues.push(`星期 ${wdRaw} 超出 1-7，已截断为 ${weekday}`);
  }
  if (weekday === null) {
    return { kind: "fail", reason: `星期无法识别：「${wdRaw ?? ""}」`, suggestion: "weekday 用 1-7 或 周一~周日" };
  }

  // 节次：旧契约 p0/p1（大节索引）优先，其次节次字符串（友好 JSON）
  const maxIdx = ctx.periods.length - 1;
  let p0 = typeof r.p0 === "number" && Number.isFinite(r.p0) ? Math.trunc(r.p0) : null;
  let p1 = typeof r.p1 === "number" && Number.isFinite(r.p1) ? Math.trunc(r.p1) : null;
  if ((p0 === null || p1 === null) && Array.isArray(r.periods) && r.periods.length >= 2) {
    const a = Number(r.periods[0]);
    const b = Number(r.periods[1]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      if (p0 === null) p0 = Math.trunc(a);
      if (p1 === null) p1 = Math.trunc(b);
    }
  }
  if (p0 === null || p1 === null) {
    const pStr = pickStr(r, ["period", "节次", "大节"]);
    if (pStr !== null) {
      const parsed = parsePeriodCell(pStr, ctx.periods);
      if (parsed) {
        if (p0 === null) p0 = parsed.p0;
        if (p1 === null) p1 = parsed.p1;
        if (parsed.overflow) {
          issues.push(`节次「${pStr}」超出作息表范围（共 ${ctx.periods.length} 个大节），已截断`);
        }
      }
    }
  }
  if (p0 === null || p1 === null) {
    return { kind: "fail", reason: "缺少节次", suggestion: "补 p0/p1（大节索引）或 节次 字段" };
  }
  const p0c = clampInt(p0, 0, maxIdx);
  const p1c = clampInt(p1, 0, maxIdx);
  if (p0c !== p0 || p1c !== p1) issues.push(`大节索引 ${p0}-${p1} 超出 0-${maxIdx}，已截断为 ${p0c}-${p1c}`);

  // 周次：数组（旧契约）或字符串
  const wRaw = r.weeks ?? r["周次"] ?? r["week"];
  let weeks: number[] | null = null;
  if (Array.isArray(wRaw)) {
    weeks = [...new Set(wRaw.map(Number).filter((w) => Number.isInteger(w) && w >= 1))].sort((a, b) => a - b);
  } else if (typeof wRaw === "string" && wRaw.trim()) {
    weeks = parseWeeksCell(wRaw, ctx.defaultWeeks);
  }
  if (weeks === null || weeks.length === 0) {
    weeks = Array.from({ length: ctx.defaultWeeks }, (_, i) => i + 1);
    issues.push(`未写周次，已按 1-${ctx.defaultWeeks} 周处理`);
  }

  const teacher = pickStr(r, ["teacher", "教师", "老师"]) ?? undefined;
  const room = pickStr(r, ["room", "教室", "地点", "location", "classroom"]) ?? undefined;
  return {
    kind: "ok",
    issues,
    row: {
      name,
      weekday,
      p0: Math.min(p0c, p1c),
      p1: Math.max(p0c, p1c),
      weeks,
      ...(teacher ? { teacher } : {}),
      ...(room ? { room } : {}),
    },
  };
}

function channelJson(text: string, ctx: BuildCtx): ChannelResult {
  const out: ChannelResult = { ok: [], warn: [], failed: [] };
  const m = stripCodeFence(text).match(/\[[\s\S]*\]/); // 容忍围栏与前后废话
  if (!m) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return out;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return out;
  parsed.forEach((item, i) => {
    pushResult(rowFromJsonObj(item, ctx), JSON.stringify(item), i + 1, out); // JSON 通道行号 = 元素序号
  });
  return out;
}

// ---------- 通道 ④：自由文本 token 剥离 ----------

/** 从剩余文本猜课程名：取最长的非数字中文/字母段（参考旧 parseTimetableText） */
function guessName(rest: string): string {
  const cleaned = rest
    .replace(/[（(][^）)]*[）)]/g, " ")
    .replace(/[^\u4e00-\u9fa5A-Za-z]/g, " ")
    .trim();
  if (!cleaned) return "";
  const parts = cleaned.split(/\s+/).filter((s) => s.length >= 2);
  if (parts.length === 0) return "";
  return parts.reduce((a, b) => (b.length > a.length ? b : a));
}

/** 周次 token：必须含「周」字，避免把节次 1-2 当周次 */
function findWeeksToken(s: string): string | null {
  const m = s.match(/第?\s*\d+(?:\s*[-~—～,，]\s*\d+)*\s*周(?:\s*[（(]\s*[单双]\s*[）)])?|[（(]?\s*[单双]\s*周\s*[）)]?/);
  return m ? m[0] : null;
}

function findPeriodToken(s: string): string | null {
  const t = s.match(/\d{1,2}:\d{2}\s*[-~—～]\s*\d{1,2}:\d{2}/);
  if (t) return t[0];
  const n = s.match(/第?\s*\d+\s*(?:[-~—～,，、]\s*\d+)?\s*节/);
  if (n) return n[0];
  const n2 = s.match(/第?\s*\d+\s*[-~—～]\s*\d+(?!\s*周)/); // 3~4 无「节」字
  return n2 ? n2[0] : null;
}

function findWeekdayToken(s: string): string | null {
  const m = s.match(/星\s*期\s*[一二三四五六日天1-7]|周\s*[一二三四五六日天1-7]|礼\s*拜\s*[一二三四五六日天1-7]/);
  return m ? m[0] : null;
}

function channelFreeText(lines: string[], ctx: BuildCtx): ChannelResult {
  const out: ChannelResult = { ok: [], warn: [], failed: [] };
  lines.forEach((line, i) => {
    const raw = line.trim();
    if (!raw || isSeparatorRow(raw)) return;
    // 不可能构成课程行的直接跳过（表头、过短、无中英文字符），避免失败数虚高抢赢结构化通道
    if (raw.length < 3 || !/[\u4e00-\u9fa5A-Za-z]/.test(raw)) return;
    if (isHeaderCells(splitCells(raw))) return;
    const weeksToken = findWeeksToken(raw);
    const weeks = weeksToken ? parseWeeksCell(weeksToken, ctx.defaultWeeks) : null;
    let rest = weeksToken ? raw.replace(weeksToken, " ") : raw;

    const periodToken = findPeriodToken(rest);
    if (!periodToken) {
      out.failed.push({ lineNo: i + 1, raw, reason: "未识别到节次", suggestion: "补上节次（如 1-2节）或时间（如 08:00-09:35）" });
      return;
    }
    const period = parsePeriodCell(periodToken, ctx.periods);
    if (!period) {
      out.failed.push({ lineNo: i + 1, raw, reason: `节次无法识别：「${periodToken}」` });
      return;
    }
    rest = rest.replace(periodToken, " ");

    const wdToken = findWeekdayToken(rest);
    if (!wdToken) {
      out.failed.push({ lineNo: i + 1, raw, reason: "未识别到星期", suggestion: "补上星期（如 周一）" });
      return;
    }
    const weekday = parseWeekdayCell(wdToken);
    if (weekday === null) {
      out.failed.push({ lineNo: i + 1, raw, reason: `星期无法识别：「${wdToken}」` });
      return;
    }
    rest = rest.replace(wdToken, " ");

    const name = guessName(rest);
    if (!name) {
      out.failed.push({ lineNo: i + 1, raw, reason: "未识别到课程名" });
      return;
    }
    const issues: string[] = [];
    if (period.overflow) {
      issues.push(`节次「${periodToken}」超出作息表范围（共 ${ctx.periods.length} 个大节），已截断`);
    }
    const finalWeeks = weeks ?? Array.from({ length: ctx.defaultWeeks }, (_, i) => i + 1);
    if (!weeks) issues.push(`未写周次，已按 1-${ctx.defaultWeeks} 周处理`);
    pushResult({ kind: "ok", issues, row: { name, weekday, p0: period.p0, p1: period.p1, weeks: finalWeeks } }, raw, i + 1, out);
  });
  return out;
}

// ---------- 入口 ----------

function channelScore(ch: ChannelResult): number {
  return (ch.ok.length + ch.warn.length) * 10000 + ch.failed.length;
}

/** 同「课程名+星期+节次+周次」去重（同课同星同期不同周次并存）；ok 优先于 warn */
function dedupeResult(ch: ChannelResult): KzsParseResult {
  const seen = new Set<string>();
  const key = (r: KzsRow) => `${r.name}|${r.weekday}|${r.p0}-${r.p1}|${r.weeks.join(",")}`;
  const ok: KzsRow[] = [];
  for (const r of ch.ok) {
    const k = key(r);
    if (seen.has(k)) continue;
    seen.add(k);
    ok.push(r);
  }
  const warn: (KzsRow & { issue: string })[] = [];
  for (const r of ch.warn) {
    const k = key(r);
    if (seen.has(k)) continue;
    seen.add(k);
    warn.push(r);
  }
  return { ok, warn, failed: ch.failed };
}

/** 解析课表文本（KZS1 四通道），返回 ok/warn/failed 三态结果 */
export function parseKzs(text: string, opts: ParseKzsOptions): KzsParseResult {
  const ctx: BuildCtx = { periods: opts.periods, defaultWeeks: opts.defaultWeeks ?? DEFAULT_WEEKS };
  if (!text || !text.trim() || opts.periods.length === 0) {
    return { ok: [], warn: [], failed: [] };
  }
  const lines = text.split(/\r?\n/);
  const channels: ChannelResult[] = [
    channelJson(text, ctx),
    channelTable(lines, ctx),
    channelKzs(lines, ctx),
    channelFreeText(lines, ctx),
  ];
  let best = channels[0];
  for (const ch of channels) {
    if (channelScore(ch) > channelScore(best)) best = ch; // 平局取靠前通道（JSON > 表格 > KZS1 > 自由文本）
  }
  return dedupeResult(best);
}
