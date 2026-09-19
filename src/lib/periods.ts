import type { Period, ScheduleSlot } from "./types";

/** 默认节次表（大学常见大节），可在设置页修改时间 */
export const DEFAULT_PERIODS: Period[] = [
  { startMin: 8 * 60, endMin: 9 * 60 + 35 }, // 1-2 节
  { startMin: 10 * 60 + 5, endMin: 11 * 60 + 40 }, // 3-4 节
  { startMin: 14 * 60, endMin: 15 * 60 + 35 }, // 5-6 节
  { startMin: 16 * 60, endMin: 17 * 60 + 35 }, // 7-8 节
  { startMin: 19 * 60, endMin: 20 * 60 + 35 }, // 9-10 节
];

/** 节次序号（0 起）→ "1-2" */
export function periodLabel(i: number): string {
  return `${i * 2 + 1}-${i * 2 + 2}`;
}

export function minToHHmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "08:00" → 480；解析失败返回 null */
export function hhmmToMin(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

/** 求课时段对应的节次范围（连续行span）；自定义时间对不上返回 null */
export function locateSlotPeriods(
  slot: ScheduleSlot,
  periods: Period[],
): { start: number; end: number } | null {
  const start = periods.findIndex((p) => p.startMin === slot.startMin);
  const end = periods.findIndex((p) => p.endMin === slot.endMin);
  if (start === -1 || end === -1 || end < start) return null;
  return { start, end };
}

/** 时间范围重叠的第一个节次（自定义时间的兜底显示位置） */
export function firstOverlappingPeriod(startMin: number, endMin: number, periods: Period[]): number {
  const i = periods.findIndex((p) => startMin < p.endMin && endMin > p.startMin);
  return i === -1 ? 0 : i;
}
