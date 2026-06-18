import type { RepeaterItem } from "../types";
import InputItemField from "./InputItem";
import RadioItemField from "./RadioItem";
import SelectItemField from "./SelectItem";
import TextareaItemField from "./TextareaItem";

interface RepeaterItemProps {
	item: RepeaterItem;
	value: Record<string, Record<string, unknown>>;
	onChange: (value: Record<string, Record<string, unknown>>) => void;
}

const FIELD_COMPONENTS: Record<string, React.ComponentType<any>> = {
	input: InputItemField,
	textarea: TextareaItemField,
	select: SelectItemField,
	radio: RadioItemField,
};

export default function RepeaterItemField({
	item,
	value,
	onChange,
}: RepeaterItemProps) {
	const handleRowFieldChange = (
		rowKey: string,
		fieldKey: string,
		fieldValue: unknown,
	) => {
		const next = { ...(value || {}) };
		if (!next[rowKey]) next[rowKey] = {};
		next[rowKey] = { ...next[rowKey], [fieldKey]: fieldValue };
		onChange(next);
	};

	const getFieldValue = (rowKey: string, fieldKey: string): unknown => {
		return value?.[rowKey]?.[fieldKey];
	};

	const isFieldVisible = (
		rowKey: string,
		field: RepeaterItem["fields"][number],
	): boolean => {
		if (!field.showWhen) return true;
		for (const [depKey, depVal] of Object.entries(field.showWhen)) {
			if (getFieldValue(rowKey, depKey) !== depVal) return false;
		}
		return true;
	};

	return (
		<div className="flex flex-col gap-1.5">
			<label className="text-xs font-medium text-foreground/80">
				{item.required && <span className="text-destructive mr-0.5">*</span>}
				{item.label}
			</label>
			<div className="space-y-2">
				{item.rows.map((row) => {
					const rowValue = value?.[row.key] || {};
					return (
						<div
							key={row.key}
							className="rounded-md border border-border/60 p-2 space-y-1.5"
						>
							<span className="text-[0.65rem] font-medium text-muted-foreground">
								{row.label}
							</span>
							{item.fields.map((field) => {
								const Component = FIELD_COMPONENTS[field.type];
								if (!Component) return null;
								if (!isFieldVisible(row.key, field)) return null;
								return (
									<div key={field.key}>
										<Component
											item={{
												key: field.key,
												type: field.type,
												label: field.label,
												placeholder: field.placeholder,
												unit: field.unit,
												options: field.options,
											}}
											value={
												rowValue[field.key] !== undefined
													? rowValue[field.key]
													: ""
											}
											onChange={(v: unknown) =>
												handleRowFieldChange(row.key, field.key, v)
											}
										/>
									</div>
								);
							})}
						</div>
					);
				})}
			</div>
		</div>
	);
}
