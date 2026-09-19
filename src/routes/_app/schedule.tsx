import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ColorSwatches } from "@/components/color-swatches";
import {
  deleteSlot,
  getSettings,
  listCourses,
  listSlots,
  saveCourse,
  saveSlot,
  uid,
} from "@/lib/db";
import { getSemesterWeek, startOfDay, weekdayOf } from "@/lib/match";
import {
  firstOverlappingPeriod,
  locateSlotPeriods,
  minToHHmm,
  periodLabel,
} from "@/lib/periods";
import {
  COURSE_COLORS,
  WEEKDAY_NAMES,
  type AppSettings,
  type Course,
  type ScheduleSlot,
} from "@/lib/types";

export const Route = createFileRoute("/_app/schedule")({
  component: SchedulePage,
});

type EditorState = {
  slot: ScheduleSlot | null; // null = 新增
  weekday: number;
  periodIdx: number;
};

function SchedulePage() {
  const router = useRouter();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);

  const load = () => {
    void Promise.all([getSettings(), listSlots(), listCourses()]).then(([s, sl, c]) => {
      setSettings(s);
      setSlots(sl);
      setCourses(c);
    });
  };
  useEffect(load, []);

  const periods = settings?.periods ?? [];
  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const now = Date.now();
  const today = weekdayOf(now);
  const week = settings ? getSemesterWeek(now, settings.semesterStart) : null;
  const monday = startOfDay(now) - (today - 1) * 86400000;
  const weekDates = Array.from({ length: 7 }, (_, j) => new Date(monday + j * 86400000));

  const layout = slots
    .map((s) => {
      const located = locateSlotPeriods(s, periods);
      const startIdx = located
        ? located.start
        : firstOverlappingPeriod(s.startMin, s.endMin, periods);
      const span = located ? located.end - located.start + 1 : 1;
      return { slot: s, startIdx, span };
    })
    .filter((x) => x.startIdx >= 0 && periods.length > 0);

  return (
    <div className="px-4 pt-6">
      <header className="sticky top-0 z-30 -mx-4 mb-4 flex items-center gap-1 border-b bg-background/95 px-6 py-2.5 backdrop-blur">
        <button
          type="button"
          aria-label="返回"
          onClick={() => router.history.back()}
          className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="text-xl font-semibold tracking-tight">课表</h1>
        <div className="ml-auto">
          {week !== null ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              第 {week} 周
            </span>
          ) : (
            <Link to="/settings" className="text-xs text-primary underline-offset-2 hover:underline">
              设置学期起始周 →
            </Link>
          )}
        </div>
      </header>

      {periods.length > 0 && (
        <div className="overflow-x-auto pb-4">
          <div
            className="grid min-w-[430px] gap-px"
            style={{ gridTemplateColumns: "44px repeat(7, minmax(52px, 1fr))" }}
          >
            <div />
            {WEEKDAY_NAMES.map((name, j) => (
              <div
                key={name}
                className={`pb-1 text-center text-xs ${
                  j + 1 === today ? "font-semibold text-primary" : "text-muted-foreground"
                }`}
              >
                {name}
                <div className="text-[10px] font-normal opacity-70">
                  {weekDates[j].getMonth() + 1}/{weekDates[j].getDate()}
                </div>
              </div>
            ))}

            {periods.map((p, i) => (
              <Fragment key={i}>
                <div className="flex min-h-14 flex-col items-center justify-center text-[10px] leading-3 text-muted-foreground">
                  <span className="font-medium text-foreground">{periodLabel(i)}</span>
                  <span>{minToHHmm(p.startMin)}</span>
                </div>
                {WEEKDAY_NAMES.map((_, j) => (
                  <button
                    key={`${i}-${j}`}
                    type="button"
                    aria-label={`添加${WEEKDAY_NAMES[j]}第 ${periodLabel(i)} 节的课`}
                    style={{ gridColumn: j + 2, gridRow: i + 2 }}
                    onClick={() => setEditor({ slot: null, weekday: j + 1, periodIdx: i })}
                    className="min-h-14 rounded-md bg-muted/40 transition-colors hover:bg-muted active:bg-muted"
                  />
                ))}
              </Fragment>
            ))}

            {layout.map(({ slot, startIdx, span }) => {
              const c = courseById.get(slot.courseId);
              if (!c) return null;
              return (
                <button
                  key={slot.id}
                  type="button"
                  style={{
                    gridColumn: slot.weekday + 1,
                    gridRow: `${startIdx + 2} / span ${span}`,
                    backgroundColor: `${c.color}1a`,
                    borderLeft: `3px solid ${c.color}`,
                  }}
                  onClick={() => setEditor({ slot, weekday: slot.weekday, periodIdx: startIdx })}
                  className="z-10 m-px flex flex-col items-start justify-center overflow-hidden rounded-md px-1.5 py-1 text-left active:brightness-95"
                >
                  <span className="w-full truncate text-[11px] font-medium leading-4">{c.name}</span>
                  {span > 1 && (
                    <span className="text-[10px] leading-3 text-muted-foreground">
                      {minToHHmm(slot.startMin)}–{minToHHmm(slot.endMin)}
                    </span>
                  )}
                  <span className="text-[10px] leading-3 text-muted-foreground">
                    {slot.weekStart}-{slot.weekEnd}周
                    {slot.oddEven === "odd" ? "单" : slot.oddEven === "even" ? "双" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">点空格子添加课程，点课程块修改或删除。</p>

      {editor && settings && (
        <SlotEditorDialog
          settings={settings}
          courses={courses}
          editor={editor}
          onClose={() => setEditor(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

function SlotEditorDialog({
  settings,
  courses,
  editor,
  onClose,
  onSaved,
}: {
  settings: AppSettings;
  courses: Course[];
  editor: EditorState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = editor.slot;
  const periods = settings.periods;
  const locatedInit = editing ? locateSlotPeriods(editing, periods) : null;
  const initStart = editing
    ? (locatedInit?.start ?? firstOverlappingPeriod(editing.startMin, editing.endMin, periods))
    : editor.periodIdx;

  const [courseChoice, setCourseChoice] = useState(
    editing?.courseId ?? courses[0]?.id ?? "__new",
  );
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(
    COURSE_COLORS[courses.length % COURSE_COLORS.length],
  );
  const [weekday, setWeekday] = useState(String(editing?.weekday ?? editor.weekday));
  const [startIdx, setStartIdx] = useState(initStart);
  const [endIdx, setEndIdx] = useState(locatedInit?.end ?? initStart);
  const [weekStart, setWeekStart] = useState(String(editing?.weekStart ?? 1));
  const [weekEnd, setWeekEnd] = useState(String(editing?.weekEnd ?? 16));
  const [oddEven, setOddEven] = useState<ScheduleSlot["oddEven"]>(editing?.oddEven ?? "all");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const ws = Number(weekStart);
    const we = Number(weekEnd);
    if (courseChoice === "__new" && !newName.trim()) {
      setError("给新课程起个名字");
      return;
    }
    if (!Number.isInteger(ws) || !Number.isInteger(we) || ws < 1 || we < ws || we > 30) {
      setError("周次要填 1-30 的数字，且结束周不早于起始周");
      return;
    }
    setSaving(true);
    setError("");
    try {
      let courseId = courseChoice;
      if (courseChoice === "__new") {
        courseId = uid();
        await saveCourse({
          id: courseId,
          name: newName.trim(),
          color: newColor,
          createdAt: Date.now(),
        });
      }
      await saveSlot({
        id: editing?.id ?? uid(),
        courseId,
        weekday: Number(weekday),
        startMin: periods[startIdx].startMin,
        endMin: periods[endIdx].endMin,
        weekStart: ws,
        weekEnd: we,
        oddEven,
      });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    await deleteSlot(editing.id);
    onSaved();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "编辑课程" : "添加课程"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {courses.length > 0 && (
            <div className="space-y-1.5">
              <Label>课程</Label>
              <Select value={courseChoice} onValueChange={setCourseChoice}>
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue placeholder="选择课程" />
                </SelectTrigger>
                <SelectContent>
                  {courses.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="__new">＋ 新建课程</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {courseChoice === "__new" && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
              <div className="space-y-1.5">
                <Label>课程名称</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="如：高等数学"
                  className="min-h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label>颜色</Label>
                <ColorSwatches value={newColor} onChange={setNewColor} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>星期</Label>
              <Select value={weekday} onValueChange={setWeekday}>
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAY_NAMES.map((n, i) => (
                    <SelectItem key={n} value={String(i + 1)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>单双周</Label>
              <Select
                value={oddEven}
                onValueChange={(v) => setOddEven(v as ScheduleSlot["oddEven"])}
              >
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">每周</SelectItem>
                  <SelectItem value="odd">单周</SelectItem>
                  <SelectItem value="even">双周</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>开始节次</Label>
              <Select
                value={String(startIdx)}
                onValueChange={(v) => {
                  const n = Number(v);
                  setStartIdx(n);
                  if (endIdx < n) setEndIdx(n);
                }}
              >
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {periods.map((p, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {periodLabel(i)} · {minToHHmm(p.startMin)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>结束节次</Label>
              <Select value={String(endIdx)} onValueChange={(v) => setEndIdx(Number(v))}>
                <SelectTrigger className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {periods.slice(startIdx).map((_, k) => {
                    const i = startIdx + k;
                    return (
                      <SelectItem key={i} value={String(i)}>
                        {periodLabel(i)} · {minToHHmm(periods[i].endMin)}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {minToHHmm(periods[startIdx].startMin)} – {minToHHmm(periods[endIdx].endMin)}
            （时间在「设置」里可按学校作息调整）
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>起始周</Label>
              <Input
                type="number"
                min={1}
                max={30}
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
                className="min-h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label>结束周</Label>
              <Input
                type="number"
                min={1}
                max={30}
                value={weekEnd}
                onChange={(e) => setWeekEnd(e.target.value)}
                className="min-h-11"
              />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="mt-2 gap-2 sm:gap-0">
          {editing && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" className="mr-auto text-destructive hover:text-destructive">
                  删除此时段
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>删除这个上课时段？</AlertDialogTitle>
                  <AlertDialogDescription>
                    删除后新照片不再自动归到这个时段，已归档的照片不受影响。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>先不删</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>删除</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
