import { describe, expect, it } from "vitest";
import { matchPhoto } from "../src/lib/match";
import type { AppSettings, ScheduleSlot } from "../src/lib/types";

/** 测试基准：2026-03-02 是学期第 1 周周一（ISO 2026-03-02） */
const SEMESTER_START = "2026-03-02";

/** 造一个「某天某时刻」的时间戳（本地时区） */
function at(dateISO: string, hh: number, mm: number): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

const settings: AppSettings = {
  semesterStart: SEMESTER_START,
  periods: [],
  defaultWeeks: 16,
};

/** 默认节次：1-2 节 08:00-09:35、3-4 节 10:05-11:40 */
const slot12: ScheduleSlot = {
  id: "s12",
  courseId: "c1",
  weekday: 1,
  startMin: 8 * 60,
  endMin: 9 * 60 + 35,
  weekStart: 1,
  weekEnd: 16,
  oddEven: "all",
};

const slot34: ScheduleSlot = {
  id: "s34",
  courseId: "c2",
  weekday: 1,
  startMin: 10 * 60 + 5,
  endMin: 11 * 60 + 40,
  weekStart: 1,
  weekEnd: 16,
  oddEven: "all",
};

describe("matchPhoto（课照助手 §10.1）", () => {
  it("1. 08:30 拍，课 08:00-09:35 → 命中", () => {
    const hit = matchPhoto(at(SEMESTER_START, 8, 30), [slot12, slot34], settings);
    expect(hit?.id).toBe("s12");
  });

  it("2. 09:40 拍（刚下课）→ 命中上一节", () => {
    const hit = matchPhoto(at(SEMESTER_START, 9, 40), [slot12, slot34], settings);
    expect(hit?.id).toBe("s12");
  });

  it("3. 09:50 拍（前一节 09:35 结束、后一节 10:05 开始）→ 命中前一节", () => {
    const hit = matchPhoto(at(SEMESTER_START, 9, 50), [slot12, slot34], settings);
    expect(hit?.id).toBe("s12");
  });

  it("4. 10:00 拍（下一节未开始）→ 命中下一节", () => {
    const hit = matchPhoto(at(SEMESTER_START, 10, 0), [slot12, slot34], settings);
    expect(hit?.id).toBe("s34");
  });

  it("5. 12:00 拍，无课 → null", () => {
    const hit = matchPhoto(at(SEMESTER_START, 12, 0), [slot12, slot34], settings);
    expect(hit).toBeNull();
  });

  it("6. 第 5 周，时段仅 1-4 周 → null", () => {
    const week5 = at("2026-03-30", 8, 30); // 第 1 周 03-02 → 第 5 周 03-30
    const narrow: ScheduleSlot = { ...slot12, weekStart: 1, weekEnd: 4 };
    const hit = matchPhoto(week5, [narrow], settings);
    expect(hit).toBeNull();
  });

  it("7. 单周课：第 6 周 → null；第 5 周 → 命中", () => {
    const oddWeeks: ScheduleSlot = { ...slot12, weeks: [1, 3, 5, 7, 9, 11, 13, 15] };
    const week6 = at("2026-04-06", 8, 30); // 第 6 周
    const week5 = at("2026-03-30", 8, 30); // 第 5 周
    expect(matchPhoto(week6, [oddWeeks], settings)).toBeNull();
    expect(matchPhoto(week5, [oddWeeks], settings)?.id).toBe("s12");
  });

  it("8. 未设 semesterStart → null", () => {
    const noStart: AppSettings = { ...settings, semesterStart: "" };
    expect(matchPhoto(at(SEMESTER_START, 8, 30), [slot12, slot34], noStart)).toBeNull();
  });
});
