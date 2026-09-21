import { X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { WEEKDAY_NAMES } from "@/lib/types";
import { periodLabel } from "@/lib/periods";
import { weeksLabel } from "@/lib/match";
import type { ParseResult } from "@/lib/timetable-parse";

/** 课表导入预览：识别结果列表 + 剔除失败行 + 替换确认。各导入方式共用 */
export function TimetablePreview({
  parsed,
  droppedFailed,
  onDropFailed,
  onBack,
  importing,
  onImport,
}: {
  parsed: ParseResult;
  droppedFailed: number[];
  onDropFailed: (index: number) => void;
  onBack: () => void;
  importing: boolean;
  onImport: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        识别出 {parsed.ok.length} 节课
        {parsed.failed.length > 0 ? `，${parsed.failed.length} 行无法识别` : ""}：
      </p>
      <div className="max-h-64 space-y-1.5 overflow-y-auto">
        {parsed.ok.map((r, i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2.5 py-2 text-xs"
          >
            <span className="font-medium">{r.name}</span>
            <span className="text-muted-foreground">
              {WEEKDAY_NAMES[r.weekday - 1]} {periodLabel(r.p0)} 节
            </span>
            <span className="ml-auto text-muted-foreground">{weeksLabel(r.weeks)}</span>
          </div>
        ))}
        {parsed.failed.map((line, i) =>
          droppedFailed.includes(i) ? null : (
            <div
              key={`f-${i}`}
              className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-2.5 py-2 text-xs"
            >
              <span className="min-w-0 flex-1 truncate text-destructive/80">{line}</span>
              <span className="shrink-0 text-destructive/60">无法识别</span>
              <button
                type="button"
                aria-label="移除该行"
                onClick={() => onDropFailed(i)}
                className="rounded-full p-0.5 text-muted-foreground active:bg-muted"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ),
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        确认后会<b>替换现在的整个课表</b>：同名课程的照片归属保留，不再出现的旧课程会被删除
        （照片回到待分类）。
      </p>
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onBack}>
          重新编辑
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button className="flex-1" disabled={parsed.ok.length === 0 || importing}>
              {importing ? "导入中…" : "替换现有课表"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>替换现有课表？</AlertDialogTitle>
              <AlertDialogDescription>
                现在的课表会被清掉，按识别结果重建
                {parsed.ok.length} 节课。同名课程的照片归属保留，其余照片回到待分类。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>先不换</AlertDialogCancel>
              <AlertDialogAction onClick={onImport}>确认替换</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
