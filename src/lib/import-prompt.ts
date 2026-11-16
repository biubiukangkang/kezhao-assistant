import type { Period } from "./types";

/**
 * 生成「AI 转课表」提示词（实施方案 §7.3）。
 * 节次表、大节数、示例时间全部按用户 periods 动态生成，不写死任何时间。
 */
export function generateImportPrompt(opts: {
  periods: Period[];
  defaultWeeks: number;
  lang?: "zh" | "en";
}): string {
  const { periods, defaultWeeks, lang = "zh" } = opts;
  return lang === "en" ? enPrompt(periods, defaultWeeks) : zhPrompt(periods, defaultWeeks);
}

/** 分钟数 → "HH:MM" */
function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** 第 i 个大节（0 起）的节次区间，如 i=0 → "1-2"（每大节 2 小节，与 §7.2 小数节换算一致） */
function slotRange(i: number): string {
  return `${i * 2 + 1}-${i * 2 + 2}`;
}

/** 第二个示例用的节次下标；只有 1 个大节时回落 0 */
function exampleIndex(periods: Period[]): number {
  return periods.length > 1 ? 1 : 0;
}

function zhPrompt(periods: Period[], defaultWeeks: number): string {
  const j = exampleIndex(periods);
  const first = periods[0];
  const table = periods
    .map((p, i) => `第${slotRange(i)}节 ${hhmm(p.startMin)}-${hhmm(p.endMin)}`)
    .join("；");
  return `你是课表整理助手。请把用户给你的课表（截图、Excel/表格或文字描述均可）整理成下面这种「每行一条」的纯文本格式。

输出格式（第一行固定输出表头，之后每行一节课）：
课程名 | 星期 | 节次 | 周次 | 教师 | 教室
示例：
高等数学 | 周一 | ${slotRange(0)}节 | 1-16周 | 张三 | 50302
大学英语 | 周三 | ${slotRange(j)}节 | 1-16周(单) | 李四 |

整理规则：
1. 星期统一写成“周一”到“周日”。
2. 节次统一写成“起-止节”，例如“1-2节”。本校作息一天 ${periods.length} 个大节，每大节 2 小节：
${table}。
   如果课表里给的是时间（如 ${hhmm(first.startMin)}-${hhmm(first.endMin)}），请换算成对应节次。
3. 周次写成“1-16周”；只有单周写“1-16周(单)”，只有双周写“1-16周(双)”；零散周写“1,3,5-9周”；课表没写周次就写“1-${defaultWeeks}周”。
4. 教师、教室如果课表里没有，留空即可（竖线保留）。
5. 同一门课有多个上课时段就输出多行；一个格子里有几门课（不同周次）也拆成多行。
6. 同一门课如果横跨相邻两个大节（网格里上下两格都是它，如节次 5-8），是同一节课，只输出一行，节次写完整范围。
7. 逐个大节、逐个星期把网格扫完，最后几行的大节最容易漏；输出前自查一遍条数。
8. 忽略“上课周次”“备注”等表头和说明文字。
9. 只输出表头和数据行，不要输出任何解释、markdown 围栏或多余文字。`;
}

/** 英文版同义翻译（折叠展示用，内容与中文版等价） */
function enPrompt(periods: Period[], defaultWeeks: number): string {
  const j = exampleIndex(periods);
  const first = periods[0];
  const table = periods
    .map((p, i) => `Periods ${slotRange(i)}: ${hhmm(p.startMin)}-${hhmm(p.endMin)}`)
    .join("; ");
  return `You are a schedule-organizing assistant. Please organize the timetable the user gives you (a screenshot, an Excel/spreadsheet, or a text description) into the following line-based plain-text format.

Output format (the first line is always the header, then one line per class):
Course | Weekday | Periods | Weeks | Teacher | Room
Examples:
Calculus | Mon | ${slotRange(0)} | 1-16 | Zhang San | 50302
College English | Wed | ${slotRange(j)} | 1-16 (odd) | Li Si |

Rules:
1. Write weekdays as "Mon" through "Sun".
2. Write periods as "start-end", for example "1-2". Our school runs ${periods.length} major periods a day, 2 sub-periods each:
${table}.
   If the timetable gives times (for example ${hhmm(first.startMin)}-${hhmm(first.endMin)}), convert them to the matching periods.
3. Write weeks as "1-16"; odd weeks only as "1-16 (odd)", even weeks only as "1-16 (even)", scattered weeks as "1,3,5-9"; if the timetable has no weeks, write "1-${defaultWeeks}".
4. If the teacher or room is missing, leave it blank (keep the pipes).
5. If a course meets in several time slots, output several lines; if one cell holds several courses (different weeks), split them into several lines too.
6. If the same course spans two adjacent major periods (it appears in both grid rows, e.g. periods 5-8), it is ONE class — output one line with the full period range.
7. Scan the grid major-period by major-period and weekday by weekday; the last major-period rows are the easiest to miss. Double-check the count before answering.
8. Ignore header and note text such as "Weeks" or "Remarks".
9. Output only the header and data lines: no explanations, markdown fences, or extra text.`;
}
