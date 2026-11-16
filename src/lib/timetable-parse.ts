import { uid } from "./db";
import { deleteCourse, deleteSlot, listCourses, listSlots, saveCourse, saveSlot } from "./db";
import { weeksLabel } from "./match";
import { COURSE_COLORS, type Period, type ScheduleSlot, WEEKDAY_NAMES } from "./types";
import type { KzsParseResult, KzsRow } from "./timetable-format";

export type ParsedRow = {
  name: string;
  teacher?: string;
  weekday: number; // 1-7
  p0: number; // 0 起节次索引
  p1: number;
  weeks: number[];
  raw: string;
  room?: string; // 教室 → ScheduleSlot.room（KZS1 第 6 列）
};

export type ParseResult = {
  ok: ParsedRow[];
  failed: string[]; // 无法识别的原始行
};

const WD_MAP: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

/** "1-3周,5-7周" "单周" "1-16周(单)" 等写法 → 周次集合；无 token 返回 null */
function extractWeeks(text: string): { weeks: number[] | null; rest: string } {
  let rest = text;
  const ranges: [number, number][] = [];
  let odd = false;
  let even = false;
  let found = false;

  rest = rest.replace(/[（(]?\s*第?\s*(\d+)\s*[-~—～]\s*(\d+)\s*周\s*(单|双)?\s*[）)]?/g, (_, a, b, oe) => {
    ranges.push([Number(a), Number(b)]);
    if (oe === "单") odd = true;
    if (oe === "双") even = true;
    found = true;
    return " ";
  });
  rest = rest.replace(/[（(]?\s*第?\s*(\d+)\s*周\s*(单|双)?\s*[）)]?/g, (_, a, oe) => {
    ranges.push([Number(a), Number(a)]);
    if (oe === "单") odd = true;
    if (oe === "双") even = true;
    found = true;
    return " ";
  });
  if (/单周|周单/.test(rest)) {
    odd = true;
    found = true;
    rest = rest.replace(/单周|周单/g, " ");
  }
  if (/双周|周双/.test(rest)) {
    even = true;
    found = true;
    rest = rest.replace(/双周|周双/g, " ");
  }

  if (!found) return { weeks: null, rest };
  const rs = ranges.length > 0 ? ranges : [[1, 16]];
  const set = new Set<number>();
  for (const [a, b] of rs) {
    for (let w = Math.max(1, Math.min(a, b)); w <= Math.min(30, Math.max(a, b)); w++) {
      if (odd && w % 2 === 0) continue;
      if (even && w % 2 === 1) continue;
      set.add(w);
    }
  }
  return { weeks: [...set].sort((x, y) => x - y), rest };
}

/** "1-2节" "第3,4节" "5-6" "第 1 节" → 0 起大节索引。小节号按每大节 2 小节换算（"3-4节"=大节索引 1） */
function extractPeriods(text: string, periodCount: number): { p0: number; p1: number; rest: string } | null {
  let rest = text;
  const m1 = rest.match(/第?\s*(\d+)\s*[-~,，、]\s*(\d+)\s*节?/);
  if (m1) {
    const a = Number(m1[1]);
    const b = Number(m1[2]);
    rest = rest.replace(m1[0], " ");
    return {
      p0: Math.floor((Math.min(a, b) - 1) / 2),
      p1: Math.floor((Math.max(a, b) - 1) / 2),
      rest,
    };
  }
  const m2 = rest.match(/第\s*(\d+)\s*节/);
  if (m2) {
    const idx = Math.floor((Number(m2[1]) - 1) / 2);
    rest = rest.replace(m2[0], " ");
    return { p0: idx, p1: idx, rest };
  }
  return null;
}

/** "周一" "星期三" → 1-7；无返回 null */
function extractWeekday(text: string): { weekday: number; rest: string } | null {
  const m = text.match(/[周星]\s*期?\s*([一二三四五六日天])/);
  if (!m) return null;
  return { weekday: WD_MAP[m[1]], rest: text.replace(m[0], " ") };
}

/** 从剥掉结构 token 的剩余文本里猜课程名：取最长的非数字段 */
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

/** 从含强分隔符（| ｜ Tab 或 ≥2 空格）的列式行里取第 6 列（教室），与 KZS1 格式对齐；非列式行/不足 6 列返回 undefined */
function extractRoomColumn(line: string): string | undefined {
  if (!/[|｜\t]/.test(line) && !/\s{2,}/.test(line)) return undefined;
  const cells: string[] = [];
  const body = line.trim().replace(/^[|｜]\s*/, "").replace(/\s*[|｜]$/, "");
  for (const seg of body.split(/[|｜\t]/)) {
    const t = seg.trim();
    if (/\s{2,}/.test(t)) cells.push(...t.split(/\s{2,}/).map((c) => c.trim()));
    else cells.push(t);
  }
  if (cells.length <= 5) return undefined; // 教室是第 6 列（index 5）
  const room = (cells.length > 6 ? cells.slice(5).join(" ") : cells[5]).trim();
  return room || undefined;
}

/** 解析整段课表文本（每行一节课）；periods 为用户设置的节次表（决定大节数量与时间）；解析失败的行进 failed */
export function parseTimetableText(text: string, periods: Period[]): ParseResult {
  const ok: ParsedRow[] = [];
  const failed: string[] = [];
  for (const rawLine of text.split(/\n+/)) {
    const raw = rawLine.trim();
    if (!raw) continue;
    if (raw.length < 3) {
      failed.push(raw);
      continue;
    }

    const { weeks, rest: r1 } = extractWeeks(raw);
    const periodsParsed = extractPeriods(r1, periods.length);
    const wd = extractWeekday(periodsParsed ? periodsParsed.rest : r1);
    if (!periodsParsed || !wd) {
      failed.push(raw);
      continue;
    }
    const name = guessName(wd.rest);
    if (!name) {
      failed.push(raw);
      continue;
    }
    const p0 = Math.max(0, Math.min(periodsParsed.p0, periods.length - 1));
    const p1 = Math.max(p0, Math.min(periodsParsed.p1, periods.length - 1));
    const room = extractRoomColumn(raw);
    ok.push({
      name,
      weekday: wd.weekday,
      p0,
      p1,
      weeks: weeks ?? Array.from({ length: 16 }, (_, i) => i + 1),
      raw,
      ...(room ? { room } : {}),
    });
  }
  return { ok, failed };
}

/** 用解析结果替换现有课表（periods 为用户设置的节次表，时段分钟数按它换算）：同名课程保留（照片归属不动），不再出现的旧课程删除（照片回待分类） */
export async function applyTimetable(rows: ParsedRow[], periods: Period[]): Promise<number> {
  const names = new Set(rows.map((r) => r.name));
  for (const c of await listCourses()) {
    if (!names.has(c.name)) await deleteCourse(c.id);
  }
  const courseByName = new Map((await listCourses()).map((c) => [c.name, c]));
  let ci = 0;
  for (const name of names) {
    if (!courseByName.has(name)) {
      const c = {
        id: uid(),
        name,
        color: COURSE_COLORS[ci % COURSE_COLORS.length],
        teacher: rows.find((r) => r.name === name)?.teacher,
        createdAt: Date.now(),
      };
      await saveCourse(c);
      courseByName.set(name, c);
    }
    ci += 1;
  }
  for (const s of await listSlots()) await deleteSlot(s.id);
  let i = 0;
  for (const r of rows) {
    const course = courseByName.get(r.name);
    if (!course) continue;
    const slot: ScheduleSlot = {
      id: uid(),
      courseId: course.id,
      weekday: r.weekday,
      startMin: periods[r.p0].startMin,
      endMin: periods[r.p1].endMin,
      weeks: r.weeks,
      weekStart: r.weeks[0] ?? 1,
      weekEnd: r.weeks[r.weeks.length - 1] ?? 16,
      oddEven: "all",
      ...(r.room ? { room: r.room } : {}),
    };
    await saveSlot(slot);
    i += 1;
  }
  return i;
}

// ---------- KZS1（AI 转课表）结果桥接 ----------

/** KzsRow → 规范 KZS1 行文本（ParsedRow.raw 用；预览列表不展示，仅供排查） */
function kzsRowRaw(r: KzsRow): string {
  const wd = WEEKDAY_NAMES[r.weekday - 1] ?? `周${r.weekday}`;
  const weeks = r.weeks.length > 0 ? `${r.weeks[0]}-${r.weeks[r.weeks.length - 1]}周` : "";
  return `${r.name} | ${wd} | ${r.p0 * 2 + 1}-${r.p1 * 2 + 2}节 | ${weeks}`;
}

/**
 * KZS1 解析结果 → 导入预览/落库共用的 ParseResult：
 * warn 行（节次越界截断、缺周次补默认等）照样导入，与 ok 合并；
 * failed 行转成「第N行：原文」字符串，供 TimetablePreview 展示与剔除。
 */
export function kzsToParseResult(res: KzsParseResult): ParseResult {
  const rows: ParsedRow[] = [...res.ok, ...res.warn].map((r) => ({
    name: r.name,
    ...(r.teacher ? { teacher: r.teacher } : {}),
    ...(r.room ? { room: r.room } : {}),
    weekday: r.weekday,
    p0: r.p0,
    p1: r.p1,
    weeks: r.weeks,
    raw: kzsRowRaw(r),
  }));
  return { ok: rows, failed: res.failed.map((f) => `第${f.lineNo}行：${f.raw}`) };
}

/** 把一行解析结果导出为 KZS1 token：`课程名 | 星期 | 节次 | 周次 | 教师 | 教室`；教室为第 6 列，可回贴 parseKzs 解析 */
export function parsedRowToToken(row: ParsedRow): string {
  const wd = WEEKDAY_NAMES[row.weekday - 1] ?? `周${row.weekday}`;
  const period = `${row.p0 * 2 + 1}-${row.p1 * 2 + 2}节`;
  return [row.name, wd, period, weeksLabel(row.weeks), row.teacher ?? "", row.room ?? ""].join(" | ");
}
