import { clearAllData, saveCourse, savePhoto, saveSettings, saveSlot, uid } from "./db";
import { DEFAULT_PERIODS } from "./periods";
import type { Course, Photo, ScheduleSlot } from "./types";

const ANCHOR = "2026-09-07"; // 演示学期第 1 周周一
const P = DEFAULT_PERIODS;

type Board = { title: string; lines: string[]; bg: string; week: number; weekday: number; minutes: number };
type Demo = {
  name: string;
  color: string;
  teacher: string;
  slots: { weekday: number; p0: number; p1: number }[];
  boards: Board[];
};

const DEMOS: Demo[] = [
  {
    name: "高等数学",
    color: "#3b82f6",
    teacher: "张老师",
    slots: [
      { weekday: 1, p0: 0, p1: 0 },
      { weekday: 3, p0: 1, p1: 1 },
      { weekday: 6, p0: 1, p1: 1 },
    ],
    boards: [
      { title: "函数与极限", lines: ["lim f(x) = L", "ε-δ 语言", "两个重要极限"], bg: "#f5f1e3", week: 1, weekday: 1, minutes: 8 * 60 + 25 },
      { title: "导数与微分", lines: ["f'(x) = lim Δy/Δx", "四则运算法则", "链式法则"], bg: "#eef3fb", week: 1, weekday: 3, minutes: 10 * 60 + 20 },
      { title: "泰勒公式", lines: ["f(a+h) ≈ f(a)+f'(a)h", "佩亚诺余项", "麦克劳林展开"], bg: "#f7f4ea", week: 2, weekday: 1, minutes: 8 * 60 + 30 },
      { title: "定积分", lines: ["∫[a,b] f(x)dx", "牛顿-莱布尼茨公式", "换元法"], bg: "#f2f0e6", week: 2, weekday: 6, minutes: 10 * 60 + 25 },
    ],
  },
  {
    name: "大学英语",
    color: "#22c55e",
    teacher: "李老师",
    slots: [{ weekday: 2, p0: 0, p1: 0 }],
    boards: [
      { title: "Unit 1 Listening", lines: ["note-taking skills", "shadowing practice", "Vocab: seminar, draft"], bg: "#eef7ef", week: 1, weekday: 2, minutes: 8 * 60 + 40 },
      { title: "Unit 2 Reading", lines: ["Skimming & scanning", "Topic sentence", "Presentation prep"], bg: "#f0f7f0", week: 2, weekday: 2, minutes: 8 * 60 + 35 },
    ],
  },
  {
    name: "数据结构",
    color: "#8b5cf6",
    teacher: "王老师",
    slots: [
      { weekday: 3, p0: 0, p1: 0 },
      { weekday: 5, p0: 1, p1: 1 },
    ],
    boards: [
      { title: "链表", lines: ["单链表 / 双链表", "头插法 O(1)", "反转链表模板"], bg: "#f3effb", week: 1, weekday: 3, minutes: 8 * 60 + 20 },
      { title: "二叉树遍历", lines: ["前序 / 中序 / 后序", "层序 BFS 用队列", "递归三要素"], bg: "#f5f1fb", week: 2, weekday: 5, minutes: 10 * 60 + 15 },
    ],
  },
  {
    name: "大学物理",
    color: "#f97316",
    teacher: "刘老师",
    slots: [{ weekday: 4, p0: 2, p1: 2 }],
    boards: [
      { title: "牛顿运动定律", lines: ["F = ma", "隔离法受力分析", "非惯性系"], bg: "#fdf2e7", week: 2, weekday: 4, minutes: 14 * 60 + 10 },
    ],
  },
];

const MISC: Board[] = [
  { title: "社团招新海报", lines: ["吉他社 · 周五晚", "扫码报名"], bg: "#fdeef2", week: 1, weekday: 7, minutes: 21 * 60 + 40 },
  { title: "备忘清单", lines: ["鸡排饭 ×2", "杨枝甘露", "取快递"], bg: "#f7f7f2", week: 2, weekday: 5, minutes: 21 * 60 + 30 },
];

function drawBoard(title: string, lines: string[], bg: string, accent: string): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = 480; // 正方形：缩略图网格按 1:1 裁切不丢内容
  c.height = 480;
  const ctx = c.getContext("2d");
  if (!ctx) return Promise.reject(new Error("canvas 不可用"));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 480, 480);
  ctx.strokeStyle = "rgba(0,0,0,0.05)";
  for (let y = 96; y < 480; y += 44) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(480, y);
    ctx.stroke();
  }
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 10, 88);
  ctx.fillStyle = "#1f2937";
  ctx.font = "bold 34px 'Segoe UI', sans-serif";
  ctx.fillText(title, 40, 76);
  ctx.font = "24px 'Segoe UI', sans-serif";
  ctx.fillStyle = "#374151";
  lines.forEach((t, i) => ctx.fillText(t, 44, 150 + i * 50));
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.font = "18px sans-serif";
  ctx.fillText("课堂板书", 388, 452);
  return new Promise((resolve) => c.toBlob((b) => resolve(b as Blob), "image/jpeg", 0.85));
}

function capturedAtOf(week: number, weekday: number, minutes: number): number {
  const [y, m, d] = ANCHOR.split("-").map(Number);
  const base = new Date(y, m - 1, d).getTime();
  return base + ((week - 1) * 7 + (weekday - 1)) * 86400000 + minutes * 60000;
}

function toPhoto(
  courseId: string | null,
  blob: Blob,
  b: Board,
  matchMethod: Photo["matchMethod"],
): Photo {
  return {
    id: uid(),
    courseId,
    capturedAt: capturedAtOf(b.week, b.weekday, b.minutes),
    capturedSource: "camera",
    storageKey: "local",
    matchMethod,
    batchId: "seed",
    starred: false,
    blob,
    createdAt: Date.now(),
  };
}

/** 填充演示数据：先清空，再写入示例课程、课表和照片 */
export async function seedDemoData(): Promise<{ courses: number; photos: number }> {
  await clearAllData();
  await saveSettings({ semesterStart: ANCHOR, periods: DEFAULT_PERIODS });
  const photos: Photo[] = [];
  let courseCount = 0;
  for (const demo of DEMOS) {
    const course: Course = {
      id: uid(),
      name: demo.name,
      color: demo.color,
      teacher: demo.teacher,
      createdAt: Date.now(),
    };
    await saveCourse(course);
    courseCount += 1;
    for (const s of demo.slots) {
      const slot: ScheduleSlot = {
        id: uid(),
        courseId: course.id,
        weekday: s.weekday,
        startMin: P[s.p0].startMin,
        endMin: P[s.p1].endMin,
        weekStart: 1,
        weekEnd: 16,
        oddEven: "all",
      };
      await saveSlot(slot);
    }
    for (const b of demo.boards) {
      photos.push(toPhoto(course.id, await drawBoard(b.title, b.lines, b.bg, demo.color), b, "auto"));
    }
  }
  for (const b of MISC) {
    photos.push(toPhoto(null, await drawBoard(b.title, b.lines, b.bg, "#94a3b8"), b, "unmatched"));
  }
  for (const p of photos) await savePhoto(p);
  return { courses: courseCount, photos: photos.length };
}
