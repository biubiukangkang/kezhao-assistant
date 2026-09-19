import * as XLSX from "xlsx";
import type { ParsedRow } from "./timetable-parse";

export type XlsSlot = ParsedRow & { teacher?: string };

const WD_MAP: Record<string, number> = {
  星期一: 1,
  星期二: 2,
  星期三: 3,
  星期四: 4,
  星期五: 5,
  星期六: 6,
  星期日: 7,
  星期天: 7,
};

/** "1-8,10-11,13-18" → [1..8,10,11,13..18] */
function expandWeekRanges(text: string): number[] {
  const set = new Set<number>();
  for (const m of text.matchAll(/(\d+)\s*[-~]\s*(\d+)|(\d+)/g)) {
    const a = Number(m[1] ?? m[3]);
    const b = Number(m[2] ?? m[3]);
    for (let w = Math.max(1, Math.min(a, b)); w <= Math.min(30, Math.max(a, b)); w++) set.add(w);
  }
  return [...set].sort((x, y) => x - y);
}

/** 解析格子里的周次行："1-8,10-11,13-18([周])[01-02节]" → 周次数组；不匹配返回 null */
function parseWeekLine(line: string): number[] | null {
  const m = line.match(/((?:\d+\s*[-~]\s*\d+|\d+)(?:\s*,\s*(?:\d+\s*[-~]\s*\d+|\d+))*)\s*[（(]\s*\[?周\]?\s*[）)]/);
  if (!m) return null;
  const weeks = expandWeekRanges(m[1]);
  return weeks.length > 0 ? weeks : null;
}

/**
 * 解析教务系统导出的 .xls/.xlsx 课表（矩阵形态：列=星期，行=第 X 大节，
 * 格子 = 课程名\n教师\n周次([周])[小节]\n教室，一格可含多门课）。
 */
export function parseTimetableWorkbook(data: ArrayBuffer): XlsSlot[] {
  const wb = XLSX.read(data, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const grid: string[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: true,
  });

  // 1. 表头行：含"星期一"的行 → 列 → weekday
  const headerRowIdx = grid.findIndex((row) =>
    row.some((c) => typeof c === "string" && WD_MAP[c.trim()] !== undefined),
  );
  if (headerRowIdx === -1) return [];
  const colWeekday = new Map<number, number>();
  grid[headerRowIdx].forEach((c, col) => {
    const wd = WD_MAP[String(c).trim()];
    if (wd) colWeekday.set(col, wd);
  });
  if (colWeekday.size === 0) return [];

  // 2. 课行：第一列含"第X大节"（或纯数字行序）→ 大节索引
  const slots: XlsSlot[] = [];
  for (let r = headerRowIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    const firstCell = String(row[0] ?? "");
    const bigMatch = firstCell.match(/第\s*([一二三四五六七八九十\d]+)\s*大节/);
    if (!bigMatch) continue;
    const cnNum: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    const periodIdx = Number.isNaN(Number(bigMatch[1]))
      ? (cnNum[bigMatch[1]] ?? 0) - 1
      : Number(bigMatch[1]) - 1;
    if (periodIdx < 0) continue;

    // 3. 每列格子 → 一或多门课（结构：课程名/教师/周次([周])[小节]/教室，可多门连排）
    for (const [col, weekday] of colWeekday) {
      const cell = String(row[col] ?? "").trim();
      if (!cell) continue;
      const parts = cell
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length === 0) continue;

      const courses: { name: string; teacher?: string; weeks: number[] }[] = [];
      let current: { name: string; teacher?: string; weeks?: number[] } | null = null;
      for (const part of parts) {
        const weeks = parseWeekLine(part);
        if (weeks) {
          if (!current) current = { name: "未命名课程" };
          current.weeks = weeks;
          continue;
        }
        // 教室行形如 50302 / 阶4 / 实验室60336（短、数字收尾、前缀≤4 字）
        const looksLikeRoom =
          part.length <= 12 && /^[\u4e00-\u9fa5]{0,4}[A-Za-z]?\d+[A-Za-z]?$/.test(part.trim());
        if (!current) {
          current = { name: looksLikeRoom ? "未命名课程" : part };
          continue;
        }
        if (current.weeks) {
          // 上一门已收尾：教室行忽略，否则是下一门课的名称
          if (looksLikeRoom) continue;
          courses.push(current as { name: string; teacher?: string; weeks: number[] });
          current = { name: part };
          continue;
        }
        if (!current.teacher && !looksLikeRoom) current.teacher = part;
      }
      if (current?.name && current.weeks && current.weeks.length > 0) {
        courses.push(current as { name: string; teacher?: string; weeks: number[] });
      }

      for (const course of courses) {
        if (!course.name || !course.weeks || course.weeks.length === 0) continue;
        slots.push({
          name: course.name,
          teacher: course.teacher,
          weekday,
          p0: periodIdx,
          p1: periodIdx,
          weeks: course.weeks,
          raw: cell.replace(/\n+/g, " / "),
        });
      }
    }
  }
  return slots;
}
