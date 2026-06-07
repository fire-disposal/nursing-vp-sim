import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { InputItem } from "../types";

interface InputItemProps {
  item: InputItem;
  value: string;
  onChange: (value: string) => void;
}

export default function InputItemField({ item, value, onChange }: InputItemProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs font-medium text-foreground/80 shrink-0 min-w-[72px]">
        {item.required && <span className="text-destructive mr-0.5">*</span>}
        {item.label}
      </label>
      <div className="flex-1 relative">
        <Input
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={item.placeholder}
          className={cn("h-7 text-xs pr-8", item.unit && "pr-12")}
        />
        {item.unit && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[0.6rem] text-muted-foreground pointer-events-none">{item.unit}</span>}
      </div>
    </div>
  );
}
