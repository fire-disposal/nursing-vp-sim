import { Input } from "@/components/ui/input";
import type { VitalSignItem } from "../types";

interface VitalSignItemProps {
  item: VitalSignItem;
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}

const FIELDS = [
  { key: "temperature", label: "体温", unit: "℃", placeholder: "36.0-37.3" },
  { key: "pulse", label: "脉搏", unit: "次/分", placeholder: "60-100" },
  { key: "breath", label: "呼吸", unit: "次/分", placeholder: "16-20" },
  { key: "bp_systolic", label: "收缩压", unit: "mmHg", placeholder: "90-140" },
  { key: "bp_diastolic", label: "舒张压", unit: "mmHg", placeholder: "60-90" },
  { key: "spo2", label: "血氧", unit: "%", placeholder: "95-100" },
];

export default function VitalSignItemField({ item: _item, value, onChange }: VitalSignItemProps) {
  const update = (key: string, val: string) => {
    onChange({ ...(value || {}), [key]: val });
  };

  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-2">
      {FIELDS.map((field) => (
        <div key={field.key} className="flex flex-col gap-0.5">
          <label className="text-[0.6rem] font-medium text-muted-foreground">{field.label}</label>
          <div className="relative">
            <Input
              value={value?.[field.key] || ""}
              onChange={(e) => update(field.key, e.target.value)}
              placeholder={field.placeholder}
              className="h-7 text-xs pr-10"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[0.6rem] text-muted-foreground pointer-events-none">{field.unit}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
