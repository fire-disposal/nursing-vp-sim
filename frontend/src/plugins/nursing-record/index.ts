import React, { useState } from "react";
import type { SlotProps, TrainingPlugin } from "@/engine/types";
import CheckboxGroupItemField from "./items/CheckboxGroupItem";

import InputItemField from "./items/InputItem";
import RadioItemField from "./items/RadioItem";
import SelectItemField from "./items/SelectItem";
import TextareaItemField from "./items/TextareaItem";
import VitalSignItemField from "./items/VitalSignItem";
import NursingRecordPanel from "./NursingRecordPanel";
import type { ItemType, RecordSheetItem } from "./types";

export const ITEM_COMPONENTS: Record<
  ItemType,
  React.ComponentType<{
    item: RecordSheetItem;
    value: unknown;
    onChange: (value: unknown) => void;
  }>
> = {
  input: InputItemField as React.ComponentType<{ item: RecordSheetItem; value: unknown; onChange: (value: unknown) => void }>,
  textarea: TextareaItemField as React.ComponentType<{ item: RecordSheetItem; value: unknown; onChange: (value: unknown) => void }>,
  select: SelectItemField as React.ComponentType<{ item: RecordSheetItem; value: unknown; onChange: (value: unknown) => void }>,
  radio: RadioItemField as React.ComponentType<{ item: RecordSheetItem; value: unknown; onChange: (value: unknown) => void }>,
  checkbox_group: CheckboxGroupItemField as React.ComponentType<{ item: RecordSheetItem; value: unknown; onChange: (value: unknown) => void }>,
  vital_sign: VitalSignItemField as React.ComponentType<{ item: RecordSheetItem; value: unknown; onChange: (value: unknown) => void }>,
};

function NursingRecordSlotAdapter({ ctx }: SlotProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Workaround for biome unused variable warning — calling setIsOpen through onToggle
  const handleToggle = () => setIsOpen(!isOpen);

  return React.createElement(NursingRecordPanel, {
    isOpen,
    onToggle: handleToggle,
    recordId: ctx.recordId,
  });
}

export const nursingRecordPlugin: TrainingPlugin = {
  id: "nursing-record",
  name: "护理记录",
  meta: {
    description: "可配置的护理记录面板，支持 input/textarea/select/radio/checkbox_group/vital_sign 六种字段",
    icon: "clipboard-edit",
    tags: ["ui", "panel", "record"],
  },
  slots: {
    panel: NursingRecordSlotAdapter,
  },
};
