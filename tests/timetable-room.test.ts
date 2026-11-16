import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseKzs } from "../src/lib/timetable-format";
import { applyTimetable, parsedRowToToken, parseTimetableText } from "../src/lib/timetable-parse";
import { DEFAULT_PERIODS } from "../src/lib/periods";
import type { Period } from "../src/lib/types";

// mock db（内存 courses/slots）：applyTimetable 落库用，验证 ScheduleSlot.room
const { store } = vi.hoisted(() => ({
  store: {
    courses: [] as { id: string; name: string }[],
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

const PERIODS: Period[] = DEFAULT_PERIODS; // 真实 5 大节

beforeEach(() => {
  store.courses = [];
  store.slots = [];
  idSeq = 0;
});

describe("T07 教室贯通 · 文本解析取教室列", () => {
  it("全角竖线分隔：第 6 列为教室", () => {
    const r = parseTimetableText("高等数学 ｜ 周一 ｜ 1-2节 ｜ 1-16周 ｜ 张三 ｜ 50302", PERIODS);
    expect(r.failed).toEqual([]);
    expect(r.ok).toHaveLength(1);
    expect(r.ok[0]).toMatchObject({ name: "高等数学", weekday: 1, room: "50302" });
  });

  it("半角竖线分隔", () => {
    const r = parseTimetableText("高等数学 | 周一 | 1-2节 | 1-16周 | 张三 | 50302", PERIODS);
    expect(r.ok[0].room).toBe("50302");
  });

  it("Tab 分隔", () => {
    const r = parseTimetableText("高等数学\t周一\t1-2节\t1-16周\t张三\t50302", PERIODS);
    expect(r.ok[0].room).toBe("50302");
  });

  it("≥2 空格分隔", () => {
    const r = parseTimetableText("高等数学  周一  1-2节  1-16周  张三  50302", PERIODS);
    expect(r.ok[0].room).toBe("50302");
  });

  it("教室含分隔符时 >6 列尾部并入（实验 | 603 → 实验 603）", () => {
    const r = parseTimetableText("高等数学 | 周一 | 1-2节 | 1-16周 | 张三 | 实验 | 603", PERIODS);
    expect(r.ok[0]).toMatchObject({ name: "高等数学", room: "实验 603" });
  });

  it("不足 6 列 / 非列式自由文本 → 不误取教室", () => {
    expect(parseTimetableText("高等数学 周一 1-2节 1-16周", PERIODS).ok[0].room).toBeUndefined();
    expect(parseTimetableText("高等数学 | 周一 | 1-2节 | 1-16周", PERIODS).ok[0].room).toBeUndefined();
  });
});

describe("T07 教室贯通 · KZS1 第 6 列教室", () => {
  it("parseKzs：第 6 列为教室", () => {
    const r = parseKzs("高等数学 | 周一 | 1-2节 | 1-16周 | 张三 | 50302", { periods: PERIODS });
    expect(r.failed).toEqual([]);
    expect(r.ok).toHaveLength(1);
    expect(r.ok[0]).toMatchObject({ name: "高等数学", weekday: 1, teacher: "张三", room: "50302" });
  });

  it("parseKzs：缺教室列 → room 为空", () => {
    const r = parseKzs("高等数学 | 周一 | 1-2节 | 1-16周 | 张三 |", { periods: PERIODS });
    expect(r.ok[0].room).toBeUndefined();
  });
});

describe("T07 教室贯通 · 文本导入端到端落库", () => {
  it("parseTimetableText → applyTimetable：room 写入 ScheduleSlot.room", async () => {
    const r = parseTimetableText(
      [
        "高等数学 | 周一 | 1-2节 | 1-16周 | 张三 | 50302",
        "大学物理 | 周五 | 5-6节 | 1-16周 | 李四 | 理科楼207",
      ].join("\n"),
      PERIODS,
    );
    const n = await applyTimetable(r.ok, PERIODS);
    expect(n).toBe(2);

    const mathId = store.courses.find((c) => c.name === "高等数学")!.id;
    expect(store.slots.find((s) => s.courseId === mathId)).toMatchObject({
      weekday: 1,
      startMin: 480,
      endMin: 575,
      room: "50302",
    });

    const physId = store.courses.find((c) => c.name === "大学物理")!.id;
    expect(store.slots.find((s) => s.courseId === physId)).toMatchObject({
      weekday: 5,
      startMin: 840,
      endMin: 935,
      room: "理科楼207",
    });
  });

  it("无教室的行不写 room 字段（与旧行为一致）", async () => {
    const r = parseTimetableText("线性代数 | 周三 | 3-4节 | 1-16周 | 王五 |", PERIODS);
    await applyTimetable(r.ok, PERIODS);
    const id = store.courses.find((c) => c.name === "线性代数")!.id;
    expect(store.slots.find((s) => s.courseId === id)).not.toHaveProperty("room");
  });
});

describe("T07 教室贯通 · token 导出含教室", () => {
  it("parsedRowToToken：第 6 列为教室，与 KZS1 格式对齐", () => {
    const token = parsedRowToToken({
      name: "高等数学",
      weekday: 1,
      p0: 0,
      p1: 0,
      weeks: Array.from({ length: 16 }, (_, i) => i + 1),
      teacher: "张三",
      room: "50302",
      raw: "",
    });
    const cols = token.split("|").map((s) => s.trim());
    expect(cols).toHaveLength(6);
    expect(cols[0]).toBe("高等数学");
    expect(cols[1]).toBe("周一");
    expect(cols[2]).toBe("1-2节");
    expect(cols[3]).toBe("1-16周");
    expect(cols[4]).toBe("张三");
    expect(cols[5]).toBe("50302"); // 第 6 列教室
  });

  it("无教室时第 6 列为空（不省略竖线）", () => {
    const token = parsedRowToToken({
      name: "体育",
      weekday: 5,
      p0: 2,
      p1: 2,
      weeks: [1, 2],
      raw: "",
    });
    const cols = token.split("|").map((s) => s.trim());
    expect(cols).toHaveLength(6);
    expect(cols[5]).toBe("");
  });
});
