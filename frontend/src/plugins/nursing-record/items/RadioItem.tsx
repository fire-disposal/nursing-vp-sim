import { cn } from "@/lib/utils";
import type { RadioItem } from "../types";

interface RadioItemProps {
  item: RadioItem;
  value: string;
  onChange: (value: string) => void;
}

export default function RadioItemField({ item, value, onChange }: RadioItemProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs font-medium text-foreground/80 shrink-0 min-w-[72px]">
        {item.required && <span className="text-destructive mr-0.5">*</span>}
        {item.label}
      </label>
      <div className="flex flex-wrap gap-1">
        {item.options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={cn(
              "px-2 py-0.5 rounded-md border text-xs transition-colors",
              value === opt
                ? "border-primary bg-primary/10 text-primary font-medium"
                : "border-border bg-transparent text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
