import type { AppSettings, ScheduleSlot } from "./types";

/** 放宽匹配窗口（分钟）：上课刚开始/刚结束拍的也算 */
export const RELAX_MIN = 15;
export const MAX_SEMESTER_WEEKS = 30;

export function startOfDay(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** JS getDay 0=周日 → 转成 1=周一 … 7=周日 */
export function weekdayOf(t: number): number {
  const d = new Date(t).getDay();
  return d === 0 ? 7 : d;
}

/** 以第 1 周周一 00:00 为锚点算学期周次；未设锚点或越界返回 null */
export function getSemesterWeek(t: number, semesterStart: string): number | null {
  if (!semesterStart) return null;
  const [y, m, d] = semesterStart.split("-").map(Number);
  if (!y || !m || !d) return null;
  const anchor = new Date(y, m - 1, d);
  if (Number.isNaN(anchor.getTime())) return null;
  const week = Math.floor((startOfDay(t) - startOfDay(anchor.getTime())) / (7 * 24 * 3600 * 1000)) + 1;
  if (week < 1 || week > MAX_SEMESTER_WEEKS) return null;
  return week;
}

export function slotCoversWeek(slot: ScheduleSlot, week: number): boolean {
  if (week < slot.weekStart || week > slot.weekEnd) return false;
  if (slot.oddEven === "odd" && week % 2 === 0) return false;
  if (slot.oddEven === "even" && week % 2 === 1) return false;
  return true;
}

/** 某天在上的全部课（按星期 + 周次过滤），用于首页"今日课程" */
export function slotsOnDate(
  t: number,
  slots: ScheduleSlot[],
  settings: AppSettings,
): ScheduleSlot[] {
  const week = getSemesterWeek(t, settings.semesterStart);
  if (week === null) return [];
  return slots
    .filter((s) => s.weekday === weekdayOf(t) && slotCoversWeek(s, week))
    .sort((a, b) => a.startMin - b.startMin);
}

/**
 * 用照片拍摄时间匹配课表（纯函数）。
 * 先严格匹配（照片时间落在上课时段内）；未中再放宽 ±15 分钟（刚上课/刚下课拍）。
 * 多个命中取开始时间距照片时间最近者；仍未中 → null（待分类）。
 */
export function matchPhoto(
  t: number,
  slots: ScheduleSlot[],
  settings: AppSettings,
): ScheduleSlot | null {
  const weekday = weekdayOf(t);
  const d = new Date(t);
  const minutes = d.getHours() * 60 + d.getMinutes();
  const week = getSemesterWeek(t, settings.semesterStart);
  if (week === null) return null;

  const candidates = slots.filter((s) => s.weekday === weekday && slotCoversWeek(s, week));
  if (candidates.length === 0) return null;

  const strict = candidates.filter((s) => minutes >= s.startMin && minutes <= s.endMin);
  const pool =
    strict.length > 0
      ? strict
      : candidates.filter(
          (s) => minutes >= s.startMin - RELAX_MIN && minutes <= s.endMin + RELAX_MIN,
        );
  if (pool.length === 0) return null;

  return pool.reduce((best, s) =>
    Math.abs(minutes - s.startMin) < Math.abs(minutes - best.startMin) ? s : best,
  );
}
