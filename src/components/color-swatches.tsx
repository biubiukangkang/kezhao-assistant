import { COURSE_COLORS } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ColorSwatches({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {COURSE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`选择颜色 ${c}`}
          onClick={() => onChange(c)}
          className={cn(
            "size-8 rounded-full border-2 transition-transform",
            value === c ? "scale-110 border-foreground" : "border-transparent",
          )}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}
