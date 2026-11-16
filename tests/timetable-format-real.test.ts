// 真实教务课表回归（2026-10-24 宸哥提供：南林大 2026-2027-1 学生个人课表）。
// 两条路径：xls 转出的「理想 AI 输出」（含跨大节/复杂周次/超界节次）与
// 截图 OCR 的「脏 AI 输出」（错字/重复行/遗漏）。钉死解析契约，改动解析器前先过这里。
import { describe, expect, it } from "vitest";

import { DEFAULT_PERIODS } from "../src/lib/periods";
import { parseKzs } from "../src/lib/timetable-format";

const OPTS = {
  periods: DEFAULT_PERIODS.map((p) => ({ ...p })),
  defaultWeeks: 16,
} as const;

// 「理想 AI 输出」：矩阵课表合并跨大节重复后的 17 行
const XLS_TEXT = `课程名 | 星期 | 节次 | 周次 | 教师 | 教室
环境经济学 | 周一 | 1-2节 | 1-8,11,13-18周 | 刘庆阳 | 50302
生物与生态修复技术(双语) | 周二 | 1-2节 | 1-8,10-11,13-18周 | 朱长银 | 50302
生态工程学B | 周四 | 1-2节 | 1-8,10-11,13-18周 | 佟思纯 | 0238
水污染控制工程C | 周五 | 1-3节 | 1-8,10-11周 | 李川 | 0234
形势与政策（5） | 周六 | 1-4节 | 14-15周 | 牛庆燕,聂永江 | 阶4
体育(5) | 周二 | 3-4节 | 1-5,10-12周 | 张敏 |
环境保护法律法规 | 周三 | 3-4节 | 1-8,10-11,13-18周 | 张萌 | 50303
水污染控制工程C | 周四 | 3-4节 | 1-8,10周 | 李川 | 0234
水土污染控制新技术与案例 | 周一 | 5-6节 | 10周 | 张萌 | 50416
环境经济学 | 周一 | 5-6节 | 13周 | 刘庆阳 | 50302
环境化学 | 周二 | 5-7节 | 1,3-5,7-8,10-11,13-18周 | 李威 | 50303
水土污染控制新技术与案例 | 周三 | 5-6节 | 1-8,11,13-18周 | 张萌 | 50420
湿地生态学 | 周四 | 5-6节 | 1-8,10-11,13-18周 | 栾兆擎,刘德燕 | 50616
环境化学 | 周五 | 5-7节 | 2周 | 李威 | 50314
环境化学实验 | 周五 | 5-8节 | 6-8,13-17周 | 李威 | 实验室60336
环境化学 | 周五 | 5-7节 | 18周 | 李威 | 50304
影视鉴赏 | 周四 | 9-11节 | 1-3,5-12周 | 樊昊 | 50301`;

// 「脏 AI 输出」：截图 OCR 的典型真实情况——教师错字、周次尾差、跨大节课未合并（重复两行）、漏掉第五大节
const IMAGE_TEXT = `课程名 | 星期 | 节次 | 周次 | 教师 | 教室
环境经济学 | 周一 | 1-2节 | 1-8,11,13-16周 | 刘庆阳 | 50302
生物与生态修复技术(双语) | 周二 | 1-2节 | 1-8,10-11,13-18周 | 朱长银 | 50302
生态工程学B | 周四 | 1-2节 | 1-8,10-11,13-18周 | 佟殿成 | 0238
水污染控制工程C | 周五 | 1-3节 | 1-8,10-11周 | 李川 | 0234
形势与政策（5） | 周六 | 1-4节 | 14-15周 | 牛庆燕,聂永江 | 阶4
体育(5)(乒乓球1) | 周二 | 3-4节 | 1-5,10-12周 | 张敏 |
环境保护法律法规 | 周三 | 3-4节 | 1-8,10-11,13-18周 | 张明 | 50303
水污染控制工程C | 周四 | 3-4节 | 1-8,10周 | 李川 | 0234
水土污染控制新技术与案例 | 周一 | 5-6节 | 10周 | 张萌 | 50416
环境经济学 | 周一 | 5-6节 | 13周 | 刘庆阳 | 50302
环境化学 | 周二 | 5-7节 | 1,3-5,7-8,10-11,13-18周 | 李威 | 50303
环境化学 | 周二 | 7-8节 | 1,3-5,7-8,10-11,13-18周 | 李威 | 50303
水土污染控制新技术与案例 | 周三 | 5-6节 | 1-8,11,13-18周 | 张萌 | 50420
湿地生态学 | 周四 | 5-6节 | 1-8,10-11,13-18周 | 刘德玺,栾兆擎 | 50516
环境化学 | 周五 | 5-7节 | 2周 | 李威 | 50314
环境化学实验 | 周五 | 5-8节 | 6-8,13-17周 | 李威 | 实验室60336
环境化学 | 周五 | 5-7节 | 18周 | 李威 | 50304`;

describe("parseKzs · 真实教务课表（南林大 2026-2027-1）", () => {
  it("理想 AI 输出：16 ok + 1 warn，零失败", () => {
    const res = parseKzs(XLS_TEXT, OPTS);
    expect(res.ok).toHaveLength(16);
    expect(res.warn).toHaveLength(1);
    expect(res.failed).toHaveLength(0);
  });

  it("跨大节课映射正确：水污染控制工程C 周五 1-3节 → 大节 0-1", () => {
    const res = parseKzs(XLS_TEXT, OPTS);
    const row = res.ok.find((r) => r.name === "水污染控制工程C" && r.weekday === 5);
    expect(row).toMatchObject({ p0: 0, p1: 1, teacher: "李川", room: "0234" });
    expect(row?.weeks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10, 11]);
  });

  it("零散周次全量展开：环境化学 周二 1,3-5,7-8,10-11,13-18周", () => {
    const res = parseKzs(XLS_TEXT, OPTS);
    const row = res.ok.find((r) => r.name === "环境化学" && r.weekday === 2 && r.p0 === 2);
    expect(row?.weeks).toEqual([1, 3, 4, 5, 7, 8, 10, 11, 13, 14, 15, 16, 17, 18]);
  });

  it("多教师与中文教室原样保留", () => {
    const res = parseKzs(XLS_TEXT, OPTS);
    const row = res.ok.find((r) => r.name === "形势与政策（5）");
    expect(row).toMatchObject({ teacher: "牛庆燕,聂永江", room: "阶4" });
    const lab = res.ok.find((r) => r.name === "环境化学实验");
    expect(lab).toMatchObject({ room: "实验室60336", weeks: [6, 7, 8, 13, 14, 15, 16, 17] });
  });

  it("超界节次截断为 warn：影视鉴赏 9-11节（作息共 10 节）→ 截到第 5 大节", () => {
    const res = parseKzs(XLS_TEXT, OPTS);
    expect(res.warn).toHaveLength(1);
    const w = res.warn[0];
    expect(w.name).toBe("影视鉴赏");
    expect(w.p0).toBe(4);
    expect(w.p1).toBe(4);
    expect(w.issue).toContain("截断");
  });

  it("脏 AI 输出：OCR 错字照单全收、重复行成独立时段、不丢行", () => {
    const res = parseKzs(IMAGE_TEXT, OPTS);
    expect(res.ok).toHaveLength(17);
    expect(res.warn).toHaveLength(0);
    expect(res.failed).toHaveLength(0);
    // 教师错字原样保留（导入后可在课程编辑里改）
    expect(res.ok.find((r) => r.name === "生态工程学B")?.teacher).toBe("佟殿成");
    // 跨大节课未合并 → 周二环境化学两行（大节 2-3 与 3），导入预览里人工取舍
    const chem = res.ok.filter((r) => r.name === "环境化学" && r.weekday === 2);
    expect(chem).toHaveLength(2);
    expect(chem[0]).toMatchObject({ p0: 2, p1: 3 });
    expect(chem[1]).toMatchObject({ p0: 3, p1: 3 });
  });
});
