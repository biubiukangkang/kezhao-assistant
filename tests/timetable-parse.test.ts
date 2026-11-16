import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KzsParseResult } from "../src/lib/timetable-format";
import { applyTimetable, kzsToParseResult, type ParsedRow } from "../src/lib/timetable-parse";
import type { Period } from "../src/lib/types";

// mock db（内存版 courses/slots）：验证 kzsToParseResult 桥接与 applyTimetable 落库约定
const { store } = vi.hoisted(() => ({
  store: {
    courses: [] as { id: string; name: string; color: string; teacher?: string; createdAt: number }[],
    slots: [] as Record<string, unknown>[],
  },
}));
let idSeq = 0;
vi.mock("../src/lib/db", () => ({
  uid: () => `id-${(idSeq += 1)}`,
  listCourses: vi.fn(async () => store.courses),
  saveCourse: vi.fn(async (c) => void store.courses.push(c)),
  deleteCourse: vi.fn(async (id) => {
    store.courses = store.courses.filter((c) => c.id !== id);
  }),
  listSlots: vi.fn(async () => store.slots),
  saveSlot: vi.fn(async (s) => void store.slots.push(s)),
  deleteSlot: vi.fn(async (id) => {
    store.slots = store.slots.filter((s) => s.id !== id);
  }),
}));

const PERIODS: Period[] = [
  { startMin: 480, endMin: 575 }, // 第1-2节
  { startMin: 605, endMin: 700 }, // 第3-4节
  { startMin: 840, endMin: 935 }, // 第5-6节
];

const RESULT: KzsParseResult = {
  ok: [
    { name: "高等数学", weekday: 1, p0: 0, p1: 0, weeks: [1, 2, 3], teacher: "张三", room: "50302" },
    { name: "体育", weekday: 5, p0: 0, p1: 1, weeks: [2, 4] },
  ],
  warn: [
    { name: "大学英语", weekday: 3, p0: 1, p1: 1, weeks: [1, 3, 5], issue: "未写周次，已按 1-16 周处理" },
  ],
  failed: [
    { lineNo: 4, raw: "某行 | 周八 | 1-2节", reason: "星期无法识别：「周八」", suggestion: "星期写成 周一~周日（或 1~7）" },
  ],
};

beforeEach(() => {
  store.courses = [];
  store.slots = [];
  idSeq = 0;
});

describe("kzsToParseResult", () => {
  it("warn 行并入 ok 一并导入，failed 转「第N行：原文」", () => {
    const r = kzsToParseResult(RESULT);
    expect(r.ok.map((x) => x.name)).toEqual(["高等数学", "体育", "大学英语"]);
    expect(r.failed).toEqual(["第4行：某行 | 周八 | 1-2节"]);
  });

  it("teacher/room 透传，raw 合成为规范 KZS1 行", () => {
    const r = kzsToParseResult(RESULT);
    expect(r.ok[0]).toMatchObject({
      name: "高等数学",
      teacher: "张三",
      room: "50302",
      weekday: 1,
      p0: 0,
      p1: 0,
      weeks: [1, 2, 3],
      raw: "高等数学 | 周一 | 1-2节 | 1-3周",
    });
    expect(r.ok[1].room).toBeUndefined();
    expect(r.ok[1].raw).toBe("体育 | 周五 | 1-4节 | 2-4周");
  });
});

describe("applyTimetable", () => {
  it("p0/p1 → periods 分钟数；weeks 双写 weekStart/weekEnd；room 落库", async () => {
    const n = await applyTimetable(kzsToParseResult(RESULT).ok, PERIODS);
    expect(n).toBe(3);
    expect(store.courses.map((c) => c.name).sort()).toEqual(["体育", "大学英语", "高等数学"]);
    // 课程教师取该课第一行的 teacher
    expect(store.courses.find((c) => c.name === "高等数学")?.teacher).toBe("张三");

    const mathId = store.courses.find((c) => c.name === "高等数学")!.id;
    expect(store.slots.find((s) => s.courseId === mathId)).toMatchObject({
      weekday: 1,
      startMin: 480,
      endMin: 575,
      weeks: [1, 2, 3],
      weekStart: 1,
      weekEnd: 3,
      oddEven: "all",
      room: "50302",
    });

    // 跨大节：p0=0,p1=1 → 第1-4节整段
    const peId = store.courses.find((c) => c.name === "体育")!.id;
    expect(store.slots.find((s) => s.courseId === peId)).toMatchObject({
      weekday: 5,
      startMin: 480,
      endMin: 700,
      weeks: [2, 4],
      weekStart: 2,
      weekEnd: 4,
      oddEven: "all",
    });

    // 无教室的行不写 room 字段（与旧行为一致）
    const engId = store.courses.find((c) => c.name === "大学英语")!.id;
    const eng = store.slots.find((s) => s.courseId === engId);
    expect(eng).toMatchObject({ weekday: 3, startMin: 605, endMin: 700, weeks: [1, 3, 5] });
    expect(eng).not.toHaveProperty("room");
  });

  it("重新导入会清掉旧课表（旧课程删除、旧时段删除）", async () => {
    store.courses = [{ id: "old", name: "旧课", color: "#000", createdAt: 0 }];
    store.slots = [
      { id: "s-old", courseId: "old", weekday: 2, startMin: 0, endMin: 1, weeks: [1], weekStart: 1, weekEnd: 1, oddEven: "all" },
    ];
    const rows: ParsedRow[] = [
      { name: "新课", weekday: 1, p0: 0, p1: 0, weeks: [1], raw: "新课 | 周一 | 1-2节 | 1周" },
    ];
    await applyTimetable(rows, PERIODS);
    expect(store.courses.map((c) => c.name)).toEqual(["新课"]);
    expect(store.slots.some((s) => s.id === "s-old")).toBe(false);
  });
});
