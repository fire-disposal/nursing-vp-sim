import { ClipboardList } from "lucide-react";
import type { PanelPlugin } from "@/engine/types";
import { NURSING_RECORD_SHEET_CONFIG } from "./config";
import CheckboxGroupItem from "./items/CheckboxGroupItem";
import InputItem from "./items/InputItem";
import RadioItem from "./items/RadioItem";
import SelectItem from "./items/SelectItem";
import TextareaItem from "./items/TextareaItem";
import VitalSignItem from "./items/VitalSignItem";
import { NursingRecordPanel } from "./NursingRecordPanel";

export const ITEM_COMPONENTS: Record<string, React.ComponentType<any>> = {
  input: InputItem,
  textarea: TextareaItem,
  select: SelectItem,
  radio: RadioItem,
  checkbox_group: CheckboxGroupItem,
  vital_sign: VitalSignItem,
};

const TOTAL_ITEMS = NURSING_RECORD_SHEET_CONFIG.sections.reduce((sum, s) => sum + s.items.length, 0);

function countFilled(data: Record<string, Record<string, unknown>>): number {
  let count = 0;
  for (const section of NURSING_RECORD_SHEET_CONFIG.sections) {
    const sectionData = data[section.key] || {};
    for (const item of section.items) {
      const val = sectionData[item.key];
      if (val !== undefined && val !== null && val !== "") count++;
    }
  }
  return count;
}

export const nursingRecordPlugin: PanelPlugin = {
  id: "nursing-record",
  meta: { name: "护理记录", description: "填写护理检查单" },
  tab: {
    icon: ClipboardList,
    label: "护理记录",
    priority: 4,
    badge: (ctx) => {
      try {
        const raw = localStorage.getItem(`nursing_record_${ctx.recordId}`);
        const data = raw ? JSON.parse(raw) : {};
        const filled = countFilled(data);
        return { text: `${filled}/${TOTAL_ITEMS}`, variant: "default" };
      } catch {
        return null;
      }
    },
  },
  component: NursingRecordPanel,
};
