/** 课程 */
export interface Course {
  id: string;
  name: string;
  color: string;
  teacher?: string;
  createdAt: number;
}

/** 课时段：星期 + 时间范围（距当天 0 点的分钟数）+ 周次 */
export interface ScheduleSlot {
  id: string;
  courseId: string;
  weekday: number; // 1=周一 … 7=周日
  startMin: number;
  endMin: number;
  weekStart: number; // 学期周次，从 1 起（旧字段，新数据保存时双写 min/max）
  weekEnd: number;
  oddEven: "all" | "odd" | "even"; // 旧字段，新数据保存时按 weeks 推导
  /** 任意周次组合（如 1-3,5-7 → [1,2,3,5,6,7]）；存在时优先于上面的范围表达 */
  weeks?: number[];
}

export type CaptureSource = "camera" | "exif" | "mtime" | "manual";
export type MatchMethod = "auto" | "manual" | "ai" | "unmatched";

/** 课堂照片 */
export interface Photo {
  id: string;
  courseId: string | null; // null = 待分类
  capturedAt: number; // 归档用的时间戳（ms）
  capturedSource: CaptureSource;
  storageKey: string; // 本地模式 = blob 内嵌在记录里；云模式 = 文件 ID
  matchMethod: MatchMethod;
  batchId: string;
  starred: boolean;
  width?: number;
  height?: number;
  /** 去重键：`${file.size}-${file.lastModified}`，同一文件重复导入时跳过 */
  sourceKey?: string;
  /** 用户手动写的提醒，如"这份作业周五交" */
  note?: string;
  /** 列表缩略图（长边 480），入库时生成；旧数据无此字段时渲染回退 blob */
  thumb?: Blob;
  /** 删除时间（ms）；存在 = 在回收站中，30 天后清理 */
  deletedAt?: number;
  blob?: Blob;
  createdAt: number;
}

/** 一节课的时间范围（分钟数） */
export interface Period {
  startMin: number;
  endMin: number;
}

/** 应用设置（meta 表单条 KV） */
export interface AppSettings {
  semesterStart: string; // 学期第 1 周周一的 ISO 日期 YYYY-MM-DD
  periods: Period[];
}

export const COURSE_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
] as const;

export const WEEKDAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;
