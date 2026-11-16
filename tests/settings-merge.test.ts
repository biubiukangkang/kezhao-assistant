import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/lib/db";
import { DEFAULT_PERIODS } from "../src/lib/periods";
import type { AppSettings } from "../src/lib/types";

describe("mergeSettings 旧数据兼容", () => {
  it("无存档回落 DEFAULT_SETTINGS", () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("旧数据缺 defaultWeeks → 补 16", () => {
    const legacy = { semesterStart: "2026-09-21", periods: [] } as unknown as AppSettings;
    const merged = mergeSettings(legacy);
    expect(merged.defaultWeeks).toBe(16);
    expect(merged.semesterStart).toBe("2026-09-21");
  });

  it("旧数据空 periods → 回落默认作息（5 大节）", () => {
    const legacy = { semesterStart: "", periods: [] } as unknown as AppSettings;
    expect(mergeSettings(legacy).periods).toEqual(DEFAULT_PERIODS);
    expect(mergeSettings(legacy).periods).toHaveLength(5);
  });

  it("新数据字段不被动过", () => {
    const custom: AppSettings = {
      semesterStart: "2026-03-02",
      periods: [{ startMin: 480, endMin: 555 }],
      defaultWeeks: 20,
      privacyAgreedAt: 123,
      seenWhatsNew: "2.0.0",
    };
    expect(mergeSettings(custom)).toEqual(custom);
  });

  it("periods 缺省（undefined）也回落", () => {
    const legacy = { semesterStart: "2026-09-21" } as unknown as AppSettings;
    expect(mergeSettings(legacy).periods).toEqual(DEFAULT_PERIODS);
  });
});
