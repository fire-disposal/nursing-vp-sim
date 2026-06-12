import { Textarea } from "@/components/ui/textarea";
import type { TextareaItem } from "../types";

interface TextareaItemProps {
	item: TextareaItem;
	value: string;
	onChange: (value: string) => void;
}

export default function TextareaItemField({
	item,
	value,
	onChange,
}: TextareaItemProps) {
	return (
		<div className="flex flex-col gap-1.5">
			<label className="text-xs font-medium text-foreground/80">
				{item.required && <span className="text-destructive mr-0.5">*</span>}
				{item.label}
			</label>
			<Textarea
				value={value || ""}
				onChange={(e) => onChange(e.target.value)}
				placeholder={item.placeholder}
				className="min-h-[48px] text-xs resize-none"
				rows={2}
			/>
		</div>
	);
}
