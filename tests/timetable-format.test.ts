import { describe, expect, it } from "vitest";
import { parseKzs, type KzsRow, type Period } from "../src/lib/timetable-format";

/** 默认作息：5 个大节（08:00-09:35 / 10:05-11:40 / 14:00-15:35 / 16:00-17:35 / 19:00-20:35） */
const PERIODS: Period[] = [
  { startMin: 8 * 60, endMin: 9 * 60 + 35 },
  { startMin: 10 * 60 + 5, endMin: 11 * 60 + 40 },
  { startMin: 14 * 60, endMin: 15 * 60 + 35 },
  { startMin: 16 * 60, endMin: 17 * 60 + 35 },
  { startMin: 19 * 60, endMin: 20 * 60 + 35 },
];

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

const run = (text: string, defaultWeeks?: number) => parseKzs(text, { periods: PERIODS, defaultWeeks });

describe("KZS1 解析 · 行式与表格", () => {
  it("1. 标准行式（表头可有可无，表头跳过）", () => {
    const r = run(
      [
        "课程名 | 星期 | 节次 | 周次 | 教师 | 教室",
        "高等数学 | 周一 | 1-2节 | 1-16周 | 张三 | 50302",
        "大学英语 | 周三 | 3-4节 | 1-16周(单) | 李四 | 文科楼201",
      ].join("\n"),
    );
    expect(r.failed).toEqual([]);
    expect(r.ok).toHaveLength(2);
    expect(r.ok[0]).toEqual<KzsRow>({
      name: "高等数学",
      weekday: 1,
      p0: 0,
      p1: 0,
      weeks: range(1, 16),
      teacher: "张三",
      room: "50302",
    });
    expect(r.ok[1].name).toBe("大学英语");
    expect(r.ok[1].weekday).toBe(3);
    expect(r.ok[1].p0).toBe(1);
    expect(r.ok[1].teacher).toBe("李四");
    expect(r.ok[1].room).toBe("文科楼201");
  });

  it("2. 全角竖线分隔", () => {
    const r = run("高等数学 ｜ 周一 ｜ 1-2节 ｜ 1-16周 ｜ 张三 ｜ 50302");
    expect(r.ok).toHaveLength(1);
    expect(r.ok[0]).toMatchObject({ name: "高等数学", weekday: 1, p0: 0, p1: 0, room: "50302" });
  });

  it("3. Tab 分隔", () => {
    const r = run("高等数学\t周一\t1-2节\t1-16周\t张三\t50302");
    expect(r.ok).toHaveLength(1);
    expect(r.ok[0]).toMatchObject({ name: "高等数学", weekday: 1, teacher: "张三" });
  });

  it("4. ≥2 个空格分隔", () => {
    const r = run("高等数学  周一  1-2节  1-16周  张三  50302");
    expect(r.ok).toHaveLength(1);
    expect(r.ok[0]).toMatchObject({ name: "高等数学", weekday: 1, p0: 0, p1: 0 });
  });

  it("5. 逗号/中文逗号弱分隔（数字间逗号受保护，不当列分隔）", () => {
    const r = run(
      [
        "高等数学,周一,1-2节,1-16周,张三,50302",
        "数据结构，周五，5,6节，1,3,5-9周，王五，实验室603",
      ].join("\n"),
    );
    expect(r.failed).toEqual([]);
    expect(r.ok).toHaveLength(2);
    expect(r.ok[0]).toMatchObject({ name: "高等数学", weekday: 1, room: "50302" });
    expect(r.ok[1]).toMatchObject({ name: "数据结构", weekday: 5, p0: 2, p1: 2, room: "实验室603" });
    expect(r.ok[1].weeks).toEqual([1, 3, 5, 6, 7, 8, 9]);
  });

  it("6. Markdown 表（表头 + 分隔行）", () => {
    const r = run(
      [
        "| 课程名 | 星期 | 节次 | 周次 | 教师 | 教室 |",
        "| --- | --- | --- | --- | --- | --- |",
        "| 高等数学 | 周一 | 1-2节 | 1-16周 | 张三 | 50302 |",
        "| 数据结构 | 周五 | 5-6节 | 1,3,5-9周 | 王五 | 实验室603 |",
      ].join("\n"),
    );
    expect(r.failed).toEqual([]);
    expect(r.ok).toHaveLength(2);
    expect(r.ok[0]).toMatchObject({ name: "高等数学", teacher: "张三", room: "50302" });
    expect(r.ok[1]).toMatchObject({ name: "数据结构", weeks: [1, 3, 5, 6, 7, 8, 9] });
  });

  it("7. 表格列序非标准（表头定列映射）", () => {
    const r = run(["课程\t时间\t星期\t周次", "高等数学\t1-2节\t周一\t1-16周"].join("\n"));
    expect(r.failed).toEqual([]);
    expect(r.ok).toHaveLength(1);
    expect(r.ok[0]).toMatchObject({ name: "高等数学", weekday: 1, p0: 0, p1: 0, weeks: range(1, 16) });
  });

  it("8. >6 列尾部并入教室", () => {
    const r = run("高等数学 | 周一 | 1-2节 | 1-16周 | 张三 | 实验楼 | 50302");
    expect(r.ok).toHaveLength(1);
    expect(r.ok[0].room).toBe("实验楼 50302");
  });

  it("9. 缺教师/教室列（4 列）", () => {
    const r = run("线性代数 | 周二 | 3-4节 | 1-16周");
    expect(r.ok).toHaveLength(1);
    expect(r.ok[0].teacher).toBeUndefined();
    expect(r.ok[0].room).toBeUndefined();
  });
});

describe("KZS1 解析 · JSON 通道", () => {
  it("10. 带 json 围栏的旧契约 {name,teacher,weekday,p0,p1,weeks}", () => {
    const text = [
      "```json",
      "[",
      '  {"name":"高等数学","teacher":"张三","weekday":1,"p0":0,"p1":0,"weeks":[1,2,3,4,5,6,7,8]},',
      '  {"name":"大学英语","teacher":"李四","weekday":3,"p0":1,"p1":1,"weeks":[9,10,11,12,13,14,15,16]}',
      "]",
      "```",
    ].join("\n");
    const r = run(text);
    expect(r.failed).toEqual([]);
    expect(r.ok).toHaveLength(2);
    expect(r.ok[0]).toEqual<KzsRow>({
      name: "高等数学",
      weekday: 1,
      p0: 0,
      p1: 0,
      weeks: range(1, 8),
      teacher: "张三",
    });
    expect(r.ok[1]).toMatchObject({ name: "大学英语", weekday: 3, p0: 1, p1: 1, weeks: range(9, 16), teacher: "李四" });
  });

  it("11. 友好 JSON（中文字段别名 + 节次/周次字符串）", () => {
    const text = [
      "[",
      '  {"课程名":"高等数学","星期":"周一","节次":"1-2节","周次":"1-16周","教师":"张三","教室":"50302"},',
      '  {"课程名":"大学英语","星期":"周三","节次":"3-4","周次":"1-16周(单)","教师":"李四","教室":"文科楼201"}',
      "]",
    ].join("\n");
    const r = run(text);
    expect(r.failed).toEqual([]);
    expect(r.ok).toHaveLength(2);
    expect(r.ok[0]).toMatchObject({ name: "高等数学", weekday: 1, room: "50302" });
    expect(r.ok[1]).toMatchObject({ name: "大学英语", weekday: 3, p0: 1, p1: 1, room: "文科楼201" });
    expect(r.ok[1].weeks).toEqual([1, 3, 5, 7, 9, 11, 13, 15]);
  });

  it("12. JSON 前后混解释文字（只抓数组）", () => {
    const text = '好的，整理结果如下：\n[{"name":"高等数学","weekday":1,"p0":0,"p1":1,"weeks":[1,2,3]}]\n希望对你有帮助';
    const r = run(text);
    expect(r.ok).toHaveLength(1);
    expect(r.ok[0]).toMatchObject({ name: "高等数学", weekday: 1, p0: 0, p1: 1, weeks: [1, 2, 3] });
  });
});

describe("KZS1 解析 · 自由文本通道", () => {
  it("13. 自由文本 token 剥离", () => {
    const r = run(["周一 第1-2节 高等数学 1-16周 张三 50302", "周三 第3-4节 大学英语 1-16周"].join("\n"));
    expect(r.ok).toHaveLength(2);
    expect(r.ok[0]).toMatchObject({ name: "高等数学", weekday: 1, p0: 0, p1: 0, weeks: range(1, 16) });
    expect(r.ok[1]).toMatchObject({ name: "大学英语", weekday: 3, p0: 1, p1: 1 });
  });

  it("14. 自由文本时间写法", () => {
    const r = run("周二 08:00-09:35 高等数学 1-16周");
    expect(r.ok).toHaveLength(1);
    expect(r.ok[0]).toMatchObject({ name: "高等数学", weekday: 2, p0: 0, p1: 0, weeks: range(1, 16) });
  });
});

describe("KZS1 解析 · 节次与时间", () => {
  it("15. 时间写法 ±15min 反查作息表", () => {
    const r = run("高等数学 | 周一 | 08:05-09:30 | 1-16周 | 张三 | 50302");
    expect(r.ok).toHaveLength(1);
    expect(r.ok[0]).toMatchObject({ p0: 0, p1: 0 });
  });

  it("16. 时间写法跨午休（08:00-15:35 → 大节 0-2）", () => {
    const r = run("高等数学 | 周一 | 08:00-15:35 | 1-16周 | 张三 | 50302");
    expect(r.ok).toHaveLength(1);
    expect(r.ok[0]).toMatchObject({ p0: 0, p1: 2 });
  });

  it("17. 越界节次 clamp + warn", () => {
    const r = run("创新创业 | 周四 | 第13节 | 1-16周 | 孙七 | 创楼101");
    expect(r.ok).toEqual([]);
    expect(r.warn).toHaveLength(1);
    expect(r.warn[0].p0).toBe(4);
    expect(r.warn[0].p1).toBe(4);
    expect(r.warn[0].issue).toContain("超出作息表范围");
  });

  it("18. 星期兼容写法（周一/星期一/周1/礼拜天/星期日/7）", () => {
    const r = run(
      [
        "课程甲 | 周一 | 1-2节 | 1-16周",
        "课程乙 | 星期一 | 1-2节 | 1-16周",
        "课程丙 | 周1 | 1-2节 | 1-16周",
        "课程丁 | 礼拜天 | 1-2节 | 1-16周",
        "课程戊 | 星期日 | 1-2节 | 1-16周",
        "课程己 | 7 | 1-2节 | 1-16周",
      ].join("\n"),
    );
    expect(r.ok.map((x) => x.weekday)).toEqual([1, 1, 1, 7, 7, 7]);
  });
});

describe("KZS1 解析 · 周次", () => {
  it("19. 单周/双周", () => {
    const r = run(
      [
        "大学英语 | 周三 | 3-4节 | 1-16周(单) | 李四 |",
        "高等数学 | 周一 | 1-2节 | 1-16周(双) | 张三 |",
      ].join("\n"),
    );
    expect(r.ok).toHaveLength(2);
    expect(r.ok[0].weeks).toEqual([1, 3, 5, 7, 9, 11, 13, 15]);
    expect(r.ok[1].weeks).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
  });

  it("20. 零散周 1,3,5-9周", () => {
    const r = run("数据结构 | 周五 | 5,6节 | 1,3,5-9周 | 王五 | 实验室603");
    expect(r.ok).toHaveLength(1);
    expect(r.ok[0].weeks).toEqual([1, 3, 5, 6, 7, 8, 9]);
    expect(r.ok[0].p0).toBe(2);
  });

  it("21. 缺周次补默认 + warn", () => {
    const r = run("线性代数 | 周二 | 3-4节 |  | 赵六 | 教三101", 20);
    expect(r.ok).toEqual([]);
    expect(r.warn).toHaveLength(1);
    expect(r.warn[0].weeks).toEqual(range(1, 20));
    expect(r.warn[0].issue).toContain("未写周次");
    expect(r.warn[0].teacher).toBe("赵六");
    expect(r.warn[0].room).toBe("教三101");
  });
});

describe("KZS1 解析 · 去重、多行、失败定位", () => {
  it("22. 一格多课两行（同课同星期同时段不同周次并存）", () => {
    const r = run(
      [
        "高等数学 | 周一 | 1-2节 | 1-8周 | 张三 | 50302",
        "高等数学 | 周一 | 1-2节 | 9-16周 | 张三 | 50302",
      ].join("\n"),
    );
    expect(r.ok).toHaveLength(2);
    expect(r.ok[0].weeks).toEqual(range(1, 8));
    expect(r.ok[1].weeks).toEqual(range(9, 16));
  });

  it("23. 重复粘贴去重（同 课程名+星期+节次+周次）", () => {
    const line = "高等数学 | 周一 | 1-2节 | 1-16周 | 张三 | 50302";
    const r = run([line, line, line].join("\n"));
    expect(r.ok).toHaveLength(1);
  });

  it("24. 缺星期 fail", () => {
    const r = run("高等数学 | 周末 | 1-2节 | 1-16周 | 张三 | 50302");
    expect(r.ok).toEqual([]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].lineNo).toBe(1);
    expect(r.failed[0].reason).toContain("星期");
  });

  it("25. 缺节次 fail", () => {
    const r = run("高等数学 | 周一 | 待定 | 1-16周 | 张三 | 50302");
    expect(r.ok).toEqual([]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].reason).toContain("节次");
  });

  it("26. <4 列 fail", () => {
    const r = run("高等数学 | 1-2节");
    expect(r.ok).toEqual([]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].reason).toContain("不足 4 列");
  });

  it("27. 解释文字混入（只取表格行，fail 定位到行号）", () => {
    const r = run(
      [
        "这是为你整理的课表：",
        "高等数学 | 周一 | 1-2节 | 1-16周 | 张三 | 50302",
        "大学英语 | 周三 | 3-4节 | 1-16周 | 李四 |",
      ].join("\n"),
    );
    expect(r.ok).toHaveLength(2);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].lineNo).toBe(1);
    expect(r.failed[0].raw).toBe("这是为你整理的课表：");
  });

  it("28. 分批粘贴合并（跨块重复行去重）", () => {
    const r = run(
      [
        "高等数学 | 周一 | 1-2节 | 1-16周 | 张三 | 50302",
        "大学英语 | 周三 | 3-4节 | 1-16周 | 李四 | 文科楼201",
        "",
        "高等数学 | 周一 | 1-2节 | 1-16周 | 张三 | 50302",
        "体育 | 周五 | 5-6节 | 1-16周 | 王五 | 操场",
      ].join("\n"),
    );
    expect(r.ok.map((x) => x.name)).toEqual(["高等数学", "大学英语", "体育"]);
  });
});

describe("KZS1 解析 · 边界与性能", () => {
  it("29. 空输入返回空结果", () => {
    expect(run("")).toEqual({ ok: [], warn: [], failed: [] });
    expect(run("   \n \n  ")).toEqual({ ok: [], warn: [], failed: [] });
  });

  it("30. 200 行解析 < 100ms", () => {
    const lines: string[] = [];
    for (let i = 0; i < 200; i++) {
      lines.push(`课程${i} | 周一 | 1-2节 | 1-16周 | 教师${i} | 教室${i}`);
    }
    const t0 = performance.now();
    const r = run(lines.join("\n"));
    const ms = performance.now() - t0;
    expect(r.ok).toHaveLength(200);
    expect(r.failed).toEqual([]);
    expect(ms).toBeLessThan(100);
  });

  it("31. weeks 升序去重、字段结构完整", () => {
    const r = run("高等数学 | 周一 | 1-2节 | 16-1周 | 张三 | 50302");
    expect(r.ok).toHaveLength(1);
    const row = r.ok[0];
    expect(Object.keys(row).sort()).toEqual(["name", "p0", "p1", "room", "teacher", "weekday", "weeks"]);
    expect(row.weeks).toEqual([...row.weeks].sort((a, b) => a - b));
    expect(new Set(row.weeks).size).toBe(row.weeks.length);
  });

  it("32. 课程名含「课程」且星期写「星期一」不被误判为表头", () => {
    const r = run(
      [
        "课程设计 | 星期三 | 1-2节 | 1-16周 | 张三 | 50302",
        "课程名 | 星期 | 节次 | 周次 | 教师 | 教室",
        "数据结构 | 星期五 | 5-6节 | 1-16周 | 李四 | 实验室603",
      ].join("\n"),
    );
    expect(r.failed).toEqual([]);
    expect(r.ok.map((x) => x.name)).toEqual(["课程设计", "数据结构"]);
    expect(r.ok[0].weekday).toBe(3);
  });
});
