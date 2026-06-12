import type { CompoundItem, RecordSheetItem } from "../types";
import RadioItemField from "./RadioItem";
import { ITEM_COMPONENTS } from "./registry";
import SelectItemField from "./SelectItem";

interface CompoundItemProps {
	item: CompoundItem;
	value: Record<string, unknown>;
	onChange: (value: Record<string, unknown>) => void;
}

function renderItem(
	subItem: RecordSheetItem,
	value: unknown,
	onChange: (v: unknown) => void,
) {
	if (
		subItem.type === "vital_sign" ||
		subItem.type === "compound" ||
		subItem.type === "repeater"
	) {
		return null;
	}
	const Component = ITEM_COMPONENTS[subItem.type];
	if (!Component) return null;
	return (
		<div key={subItem.key}>
			<Component
				item={subItem}
				value={value !== undefined ? value : ""}
				onChange={onChange}
			/>
		</div>
	);
}

export default function CompoundItemField({
	item,
	value,
	onChange,
}: CompoundItemProps) {
	const triggerValue = (value?.trigger as string) ?? "";

	const handleTriggerChange = (v: unknown) => {
		onChange({ trigger: v as string });
	};

	const handleBranchChange = (subKey: string, subValue: unknown) => {
		onChange({
			...value,
			trigger: triggerValue,
			[subKey]: subValue,
		});
	};

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-2">
				<label className="text-xs font-medium text-foreground/80 shrink-0 min-w-[72px]">
					{item.required && <span className="text-destructive mr-0.5">*</span>}
					{item.label}
				</label>
				<div className="flex-1">
					{item.trigger.type === "radio" ? (
						<RadioItemField
							item={{
								key: `${item.key}_trigger`,
								type: "radio",
								label: "",
								options: item.trigger.options,
								required: item.required,
							}}
							value={triggerValue}
							onChange={handleTriggerChange}
						/>
					) : (
						<SelectItemField
							item={{
								key: `${item.key}_trigger`,
								type: "select",
								label: "",
								options: item.trigger.options,
								placeholder: item.trigger.placeholder,
							}}
							value={triggerValue}
							onChange={handleTriggerChange}
						/>
					)}
				</div>
			</div>
			{triggerValue && item.branches[triggerValue] && (
				<div className="ml-14 space-y-1.5 pl-3 border-l-2 border-border/60">
					{item.branches[triggerValue].map((subItem) =>
						renderItem(subItem, value?.[subItem.key], (v: unknown) =>
							handleBranchChange(subItem.key, v),
						),
					)}
				</div>
			)}
		</div>
	);
}
