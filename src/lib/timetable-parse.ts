import { uid } from "./db";
import { deleteCourse, deleteSlot, listCourses, listSlots, saveCourse, saveSlot } from "./db";
import { COURSE_COLORS, type ScheduleSlot } from "./types";
import { DEFAULT_PERIODS } from "./periods";

export type ParsedRow = {
  name: string;
  weekday: number; // 1-7
  p0: number; // 0 起节次索引
  p1: number;
  weeks: number[];
  raw: string;
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

/** 解析整段课表文本（每行一节课）；解析失败的行进 failed */
export function parseTimetableText(text: string): ParseResult {
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
    const periods = extractPeriods(r1, DEFAULT_PERIODS.length);
    const wd = extractWeekday(periods ? periods.rest : r1);
    if (!periods || !wd) {
      failed.push(raw);
      continue;
    }
    const name = guessName(wd.rest);
    if (!name) {
      failed.push(raw);
      continue;
    }
    const p0 = Math.max(0, Math.min(periods.p0, DEFAULT_PERIODS.length - 1));
    const p1 = Math.max(p0, Math.min(periods.p1, DEFAULT_PERIODS.length - 1));
    ok.push({
      name,
      weekday: wd.weekday,
      p0,
      p1,
      weeks: weeks ?? Array.from({ length: 16 }, (_, i) => i + 1),
      raw,
    });
  }
  return { ok, failed };
}

/** 用解析结果替换现有课表：同名课程保留（照片归属不动），不再出现的旧课程删除（照片回待分类） */
export async function applyTimetable(rows: ParsedRow[]): Promise<number> {
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
      startMin: DEFAULT_PERIODS[r.p0].startMin,
      endMin: DEFAULT_PERIODS[r.p1].endMin,
      weeks: r.weeks,
      weekStart: r.weeks[0] ?? 1,
      weekEnd: r.weeks[r.weeks.length - 1] ?? 16,
      oddEven: "all",
    };
    await saveSlot(slot);
    i += 1;
  }
  return i;
}
