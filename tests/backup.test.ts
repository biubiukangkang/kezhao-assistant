import { describe, expect, it, vi } from "vitest";

// mock db：验证 importBackup「先全量解析校验、失败不写库；成功才单事务写入」
const { replaceAllDataMock } = vi.hoisted(() => ({ replaceAllDataMock: vi.fn() }));
vi.mock("../src/lib/db", () => ({
  getSettings: vi.fn(),
  getMetaValue: vi.fn(),
  putMetaValue: vi.fn(),
  listAllPhotos: vi.fn(),
  listCourses: vi.fn(),
  listSlots: vi.fn(),
  replaceAllData: replaceAllDataMock,
}));

import {
  backupFilename,
  backupHeadChunk,
  backupPhotoChunk,
  importBackup,
  parseBackupText,
} from "../src/lib/backup";
import type { AppSettings, Course, Photo, ScheduleSlot } from "../src/lib/types";

const EXPORTED_AT = 1740000000000;

const settings: AppSettings = {
  semesterStart: "2026-03-02",
  periods: [
    { startMin: 480, endMin: 575 },
    { startMin: 605, endMin: 700 },
  ],
  defaultWeeks: 16,
  privacyAgreedAt: 1738000000000,
};

const courses: Course[] = [
  {
    id: "c1",
    name: "高等数学",
    color: "#3b82f6",
    teacher: "张三",
    createdAt: 1,
    notes: [{ id: "n1", text: "周五交作业", at: 2 }],
  },
  { id: "c2", name: "大学英语", color: "#22c55e", createdAt: 3 },
];

/** 时段必须带 room（D7：教室进备份） */
const slots: ScheduleSlot[] = [
  {
    id: "s1",
    courseId: "c1",
    weekday: 1,
    startMin: 480,
    endMin: 575,
    weekStart: 1,
    weekEnd: 16,
    oddEven: "all",
    room: "教三-301",
  },
  {
    id: "s2",
    courseId: "c2",
    weekday: 3,
    startMin: 605,
    endMin: 700,
    weekStart: 1,
    weekEnd: 16,
    oddEven: "odd",
    weeks: [1, 3, 5, 7],
    room: "外语楼-201",
  },
];

function photo(id: string, over: Partial<Photo> = {}): Photo {
  return {
    id,
    courseId: "c1",
    capturedAt: EXPORTED_AT,
    capturedSource: "camera",
    storageKey: id,
    matchMethod: "auto",
    batchId: "b1",
    starred: false,
    createdAt: EXPORTED_AT,
    ...over,
  };
}

/** 与 backupChunks() 内部同一组纯函数拼出完整备份文本（等价导出产物） */
function serialize(
  photos: { photo: Photo; b64: string | null }[],
  exportedAt = EXPORTED_AT,
): string {
  let text = backupHeadChunk(settings, courses, slots, exportedAt);
  photos.forEach((p, i) => {
    text += backupPhotoChunk(p.photo, i, p.b64);
  });
  return text + "]}";
}

function fileOf(text: string): File {
  return new File([text], "backup.json", { type: "application/json" });
}

describe("kzb1 v2 round-trip（§10.3）", () => {
  it("v2 导出→解析：头部/课程/时段（含 room）/照片完整还原", () => {
    const photos = [
      { photo: photo("p1", { starred: true, courseId: null }), b64: null },
      { photo: photo("p2"), b64: "QUJDRA==" }, // 纯 base64
      { photo: photo("p3", { note: "第三章", width: 1920, height: 1080 }), b64: "data:image/jpeg;base64,QUJDRA==" }, // 完整 dataURL
    ];
    const text = serialize(photos);

    // 拼接结果是合法 JSON（头块 + 照片块 + "]}”）
    expect(() => JSON.parse(text)).not.toThrow();

    const parsed = parseBackupText(text);
    expect(parsed.format).toBe("kz-backup");
    expect(parsed.version).toBe(2);
    expect(parsed.exportedAt).toBe(EXPORTED_AT);
    expect(parsed.settings).toEqual(settings);
    expect(parsed.courses).toEqual(courses);
    expect(parsed.slots).toEqual(slots);
    expect(parsed.slots[0].room).toBe("教三-301");
    expect(parsed.slots[1].room).toBe("外语楼-201");
    expect(parsed.photos).toHaveLength(3);
    expect(parsed.photos[0]).toEqual({ ...photo("p1", { starred: true, courseId: null }), blobBase64: null });
    expect(parsed.photos[1]).toEqual({ ...photo("p2"), blobBase64: "QUJDRA==" });
    expect(parsed.photos[2]).toEqual({
      ...photo("p3", { note: "第三章", width: 1920, height: 1080 }),
      blobBase64: "data:image/jpeg;base64,QUJDRA==",
    });
  });

  it("照片 blob/thumb 不进备份", () => {
    const text = serialize([
      { photo: photo("p1", { blob: new Blob(["x"]), thumb: new Blob(["y"]) }), b64: "QUJD" },
    ]);
    const parsed = parseBackupText(text);
    expect(parsed.photos[0]).not.toHaveProperty("blob");
    expect(parsed.photos[0]).not.toHaveProperty("thumb");
    expect(parsed.photos[0].blobBase64).toBe("QUJD");
  });

  it("空 photos 的 v2 文件可解析", () => {
    const parsed = parseBackupText(serialize([]));
    expect(parsed.photos).toEqual([]);
  });

  it("blobBase64 三种形态均可恢复（null / 纯 base64 / 完整 dataURL）", () => {
    for (const b64 of [null, "QUJDRA==", "data:image/jpeg;base64,QUJDRA=="]) {
      const parsed = parseBackupText(serialize([{ photo: photo("p1"), b64 }]));
      expect(parsed.photos[0].blobBase64).toBe(b64);
    }
  });
});

describe("只认 v2（§4.2：v1 不迁移，不写库）", () => {
  const v1 = JSON.stringify({
    version: 1,
    exportedAt: EXPORTED_AT,
    settings,
    courses,
    slots,
    photos: [],
  });

  it("parseBackupText：v1 文件（无 format）→ 抛「版本过旧，无法恢复」", () => {
    expect(() => parseBackupText(v1)).toThrow("版本过旧，无法恢复");
  });

  it("parseBackupText：format/version 任一不匹配 → 抛「版本过旧，无法恢复」", () => {
    const wrongFormat = JSON.stringify({ format: "other", version: 2, settings, courses, slots, photos: [] });
    const wrongVersion = JSON.stringify({ format: "kz-backup", version: 1, settings, courses, slots, photos: [] });
    const v3 = JSON.stringify({ format: "kz-backup", version: 3, settings, courses, slots, photos: [] });
    expect(() => parseBackupText(wrongFormat)).toThrow("版本过旧，无法恢复");
    expect(() => parseBackupText(wrongVersion)).toThrow("版本过旧，无法恢复");
    expect(() => parseBackupText(v3)).toThrow("版本过旧，无法恢复");
  });

  it("importBackup：v1 文件明确拒绝且不写库", async () => {
    await expect(importBackup(fileOf(v1))).rejects.toThrow("版本过旧，无法恢复");
    expect(replaceAllDataMock).not.toHaveBeenCalled();
  });
});

describe("损坏文件：报错且不写库", () => {
  it("parseBackupText：非 JSON → 抛「文件读不出来」", () => {
    expect(() => parseBackupText("{ oops")).toThrow("文件读不出来，确认选的是本应用导出的备份文件");
  });

  it("parseBackupText：截断的备份文本 → 抛「文件读不出来」", () => {
    const text = serialize([{ photo: photo("p1"), b64: "QUJD" }]);
    expect(() => parseBackupText(text.slice(0, text.length - 20))).toThrow("文件读不出来");
  });

  it("importBackup：损坏 JSON → 拒绝且不写库", async () => {
    await expect(importBackup(fileOf("{ 不是 JSON"))).rejects.toThrow("文件读不出来");
    expect(replaceAllDataMock).not.toHaveBeenCalled();
  });

  it("parseBackupText：courses/slots/photos 非数组、settings 非对象 → 抛错", () => {
    const base = { format: "kz-backup", version: 2, exportedAt: EXPORTED_AT };
    expect(() => parseBackupText(JSON.stringify({ ...base, settings, courses: {}, slots, photos: [] }))).toThrow("备份文件缺少课程数据");
    expect(() => parseBackupText(JSON.stringify({ ...base, settings, courses, slots: "x", photos: [] }))).toThrow("备份文件缺少课表时段数据");
    expect(() => parseBackupText(JSON.stringify({ ...base, settings, courses, slots }))).toThrow("备份文件缺少照片数据");
    expect(() => parseBackupText(JSON.stringify({ ...base, settings: null, courses, slots, photos: [] }))).toThrow("备份文件缺少设置信息");
  });

  it("parseBackupText：照片缺 id/capturedAt、blobBase64 非法 → 抛错", () => {
    const head = serialize([]);
    const withPhoto = (p: unknown) => `${head.slice(0, -2)}${JSON.stringify(p)}]}`;
    const noId = withPhoto({ capturedAt: 1, blobBase64: null });
    const noTime = withPhoto({ id: "p1", blobBase64: null });
    const badB64Type = withPhoto({ id: "p1", capturedAt: 1, blobBase64: 123 });
    const badB64Comma = withPhoto({ id: "p1", capturedAt: 1, blobBase64: "image/jpeg;base64,QUJD" });
    const badB64Chars = withPhoto({ id: "p1", capturedAt: 1, blobBase64: "!!!!" });
    expect(() => parseBackupText(noId)).toThrow("备份里有照片记录不完整");
    expect(() => parseBackupText(noTime)).toThrow("备份里有照片记录不完整");
    expect(() => parseBackupText(badB64Type)).toThrow("备份里有照片数据损坏");
    expect(() => parseBackupText(badB64Comma)).toThrow("备份里有照片数据损坏");
    expect(() => parseBackupText(badB64Chars)).toThrow("备份里有照片数据损坏");
  });

  it("importBackup：校验失败（照片缺 id）→ 拒绝且不写库", async () => {
    const bad = `${serialize([]).slice(0, -2)}${JSON.stringify({ capturedAt: 1, blobBase64: null })}]}`;
    await expect(importBackup(fileOf(bad))).rejects.toThrow("备份里有照片记录不完整");
    expect(replaceAllDataMock).not.toHaveBeenCalled();
  });
});

describe("importBackup 写库（mock db）", () => {
  it("合法 v2：全量构造后经 replaceAllData 单事务写入，三种 blobBase64 均转为 blob", async () => {
    const text = serialize([
      { photo: photo("p1"), b64: null },
      { photo: photo("p2"), b64: "QUJDRA==" },
      { photo: photo("p3"), b64: "data:image/jpeg;base64,QUJDRA==" },
    ]);
    const r = await importBackup(fileOf(text));

    expect(r).toEqual({ courses: 2, slots: 2, photos: 3 });
    expect(replaceAllDataMock).toHaveBeenCalledTimes(1);
    const [wSettings, wCourses, wSlots, wPhotos] = replaceAllDataMock.mock.calls[0];
    expect(wSettings).toEqual(settings);
    expect(wCourses).toEqual(courses);
    expect(wSlots).toEqual(slots);
    expect(wPhotos).toHaveLength(3);
    expect(wPhotos[0].blob).toBeUndefined(); // blobBase64: null
    expect(wPhotos[1].blob).toBeInstanceOf(Blob); // 纯 base64
    expect(wPhotos[2].blob).toBeInstanceOf(Blob); // 完整 dataURL
    expect(await (wPhotos[1].blob as Blob).text()).toBe("ABCD"); // "QUJDRA==" 解码
  });
});

describe("backupFilename", () => {
  it("形如「课照助手备份-YYYYMMDD-HHmm.json」", () => {
    expect(backupFilename()).toMatch(/^课照助手备份-\d{8}-\d{4}\.json$/);
  });
});
