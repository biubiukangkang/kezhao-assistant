import { describe, expect, it } from "vitest";
import { generateImportPrompt } from "../src/lib/import-prompt";
import { DEFAULT_PERIODS } from "../src/lib/periods";
import type { Period } from "../src/lib/types";

/** 自定义 3 大节、非默认时间 */
const CUSTOM: Period[] = [
  { startMin: 7 * 60 + 30, endMin: 8 * 60 + 55 }, // 07:30-08:55
  { startMin: 9 * 60 + 10, endMin: 10 * 60 + 40 }, // 09:10-10:40
  { startMin: 13 * 60, endMin: 14 * 60 + 30 }, // 13:00-14:30
];

/** 默认作息全部时间（用于断言无残留） */
const DEFAULT_TIMES = [
  "08:00",
  "09:35",
  "10:05",
  "11:40",
  "14:00",
  "15:35",
  "16:00",
  "17:35",
  "19:00",
  "20:35",
];

describe("generateImportPrompt（§7.3 提示词生成）", () => {
  it("节次表/大节数/示例时间全部跟随自定义 periods", () => {
    const p = generateImportPrompt({ periods: CUSTOM, defaultWeeks: 20 });
    expect(p).toContain("一天 3 个大节");
    expect(p).toContain("第1-2节 07:30-08:55；第3-4节 09:10-10:40；第5-6节 13:00-14:30");
    expect(p).toContain("高等数学 | 周一 | 1-2节 | 1-16周 | 张三 | 50302");
    expect(p).toContain("大学英语 | 周三 | 3-4节 | 1-16周(单) | 李四 |");
    expect(p).toContain("（如 07:30-08:55）");
  });

  it("无默认作息时间残留", () => {
    const p = generateImportPrompt({ periods: CUSTOM, defaultWeeks: 20 });
    for (const t of DEFAULT_TIMES) expect(p).not.toContain(t);
  });

  it("defaultWeeks 正确替换", () => {
    const zh = generateImportPrompt({ periods: CUSTOM, defaultWeeks: 20 });
    expect(zh).toContain("课表没写周次就写“1-20周”");
    const en = generateImportPrompt({ periods: CUSTOM, defaultWeeks: 20, lang: "en" });
    expect(en).toContain('write "1-20"');
  });

  it("中英两份都生成，含表头行", () => {
    const zh = generateImportPrompt({ periods: CUSTOM, defaultWeeks: 16 });
    const en = generateImportPrompt({ periods: CUSTOM, defaultWeeks: 16, lang: "en" });
    expect(zh).toContain("课程名 | 星期 | 节次 | 周次 | 教师 | 教室");
    expect(en).toContain("Course | Weekday | Periods | Weeks | Teacher | Room");
    expect(en).toContain("3 major periods a day");
    expect(en).toContain("Periods 1-2: 07:30-08:55");
    expect(en).not.toContain("大节");
    for (const t of DEFAULT_TIMES) expect(en).not.toContain(t);
  });

  it("§7.3 七条整理规则要点齐全（中文）", () => {
    const p = generateImportPrompt({ periods: CUSTOM, defaultWeeks: 20 });
    expect(p).toContain("星期统一写成");
    expect(p).toContain("换算成对应节次");
    expect(p).toContain("1-16周(单)");
    expect(p).toContain("1-16周(双)");
    expect(p).toContain("1,3,5-9周");
    expect(p).toContain("留空即可");
    expect(p).toContain("也拆成多行");
    expect(p).toContain("忽略“上课周次”");
    expect(p).toContain("不要输出任何解释、markdown 围栏或多余文字");
  });

  it("默认 5 大节时中文全文与方案示例一致", () => {
    const p = generateImportPrompt({ periods: DEFAULT_PERIODS, defaultWeeks: 16 });
    expect(p).toContain("一天 5 个大节");
    expect(p).toContain(
      "第1-2节 08:00-09:35；第3-4节 10:05-11:40；第5-6节 14:00-15:35；第7-8节 16:00-17:35；第9-10节 19:00-20:35",
    );
    expect(p).toContain("（如 08:00-09:35）");
    expect(p).toContain("课表没写周次就写“1-16周”");
  });
});
