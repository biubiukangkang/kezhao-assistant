import { useState } from "react";
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
import { ColorSwatches } from "@/components/color-swatches";
import { deleteCourse, saveCourse } from "@/lib/db";
import type { Course } from "@/lib/types";

/** 编辑课程：改名/教师/颜色，或删除（照片回待分类，不丢失） */
export function CourseEditorDialog({
  course,
  photoCount,
  onSaved,
  onClose,
}: {
  course: Course;
  photoCount: number;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(course.name);
  const [teacher, setTeacher] = useState(course.teacher ?? "");
  const [color, setColor] = useState(course.color);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim()) {
      setError("课程名不能为空");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveCourse({
        ...course,
        name: name.trim(),
        teacher: teacher.trim() || undefined,
        color,
      });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    await deleteCourse(course.id);
    onSaved();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑课程</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>课程名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="min-h-11" />
          </div>
          <div className="space-y-1.5">
            <Label>教师（可选）</Label>
            <Input
              value={teacher}
              onChange={(e) => setTeacher(e.target.value)}
              placeholder="如：王老师"
              className="min-h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label>颜色</Label>
            <ColorSwatches value={color} onChange={setColor} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="mt-2 gap-2 sm:gap-0">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" className="mr-auto text-destructive hover:text-destructive">
                删除课程
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>删除课程「{course.name}」？</AlertDialogTitle>
                <AlertDialogDescription>
                  {photoCount > 0
                    ? `它和对应的上课时段会被删除；已归档的 ${photoCount} 张照片会回到「待分类」，不会丢失。`
                    : "它和对应的上课时段会被删除，此操作无法撤销。"}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>先不删</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>删除</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
