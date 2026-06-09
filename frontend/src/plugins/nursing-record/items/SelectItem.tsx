import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SelectItem as SelectItemType } from "../types";

interface SelectItemProps {
  item: SelectItemType;
  value: string;
  onChange: (value: string) => void;
}

export default function SelectItemField({ item, value, onChange }: SelectItemProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs font-medium text-foreground/80 shrink-0 min-w-[72px]">
        {item.required && <span className="text-destructive mr-0.5">*</span>}
        {item.label}
      </label>
      <Select value={value || ""} onValueChange={(v) => onChange(v ?? "")}>
        <SelectTrigger size="sm" className="flex-1 h-7 text-xs min-w-0">
          <SelectValue placeholder={item.placeholder || "请选择"} />
        </SelectTrigger>
        <SelectContent>
          {item.options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt || "—"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
