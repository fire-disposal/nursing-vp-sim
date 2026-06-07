import type React from "react";
import CheckboxGroupItemField from "./items/CheckboxGroupItem";

import InputItemField from "./items/InputItem";
import RadioItemField from "./items/RadioItem";
import SelectItemField from "./items/SelectItem";
import TextareaItemField from "./items/TextareaItem";
import VitalSignItemField from "./items/VitalSignItem";
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
