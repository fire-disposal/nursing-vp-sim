import { Check } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CheckboxGroupItem } from "../types";

interface CheckboxGroupItemProps {
	item: CheckboxGroupItem;
	value: Record<string, string>;
	onChange: (value: Record<string, string>) => void;
}

export default function CheckboxGroupItemField({
	item,
	value,
	onChange,
}: CheckboxGroupItemProps) {
	const [selected, setSelected] = useState<Set<string>>(() => {
		return new Set(Object.keys(value || {}));
	});

	const toggle = (key: string) => {
		const next = new Set(selected);
		const nextValue: Record<string, string> = {};

		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}

		for (const k of next) {
			if (value?.[k]) {
				nextValue[k] = value[k];
			}
		}

		setSelected(next);
		onChange(nextValue);
	};

	const updateDetail = (key: string, detailValue: string) => {
		const next = { ...(value || {}) };
		if (detailValue) {
			next[key] = detailValue;
		} else {
			delete next[key];
		}
		onChange(next);
	};

	return (
		<div className="flex flex-col gap-1.5">
			<label className="text-xs font-medium text-foreground/80">
				{item.required && <span className="text-destructive mr-0.5">*</span>}
				{item.label}
			</label>
			<div
				className={cn(
					"grid gap-1",
					item.columns === 3 && "grid-cols-3",
					item.columns === 2 && "grid-cols-2",
					(!item.columns || item.columns === 1) && "grid-cols-1",
				)}
			>
				{item.options.map((opt) => {
					const isSelected = selected.has(opt.key);
					return (
						<div key={opt.key} className="flex flex-col gap-1">
							<button
								type="button"
								onClick={() => toggle(opt.key)}
								className={cn(
									"flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs text-left transition-colors",
									isSelected
										? "border-primary bg-primary/10 text-primary font-medium"
										: "border-border bg-transparent text-muted-foreground hover:border-primary/40 hover:text-foreground",
								)}
							>
								<span
									className={cn(
										"w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 transition-colors",
										isSelected
											? "border-primary bg-primary text-primary-foreground"
											: "border-muted-foreground/30",
									)}
								>
									{isSelected && <Check size={10} strokeWidth={3} />}
								</span>
								<span className="truncate">{opt.label}</span>
							</button>
							{isSelected && opt.detail && (
								<Input
									value={value?.[opt.key] || ""}
									onChange={(e) => updateDetail(opt.key, e.target.value)}
									placeholder={opt.detail.placeholder}
									className="h-6 text-[0.6rem] ml-6"
								/>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
