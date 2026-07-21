import { Plus, Trash2 } from "lucide-react";
import type { DialogPair } from "./caseFormTypes";
import { emptyDialogPair } from "./caseFormTypes";
import { inputClass } from "@/utils/styles";

interface Props {
	value: DialogPair[];
	onChange: (v: DialogPair[]) => void;
	disabled?: boolean;
}

export function DialoguesEditor({ value, onChange, disabled }: Props) {
	const add = () => onChange([...value, emptyDialogPair()]);

	const remove = (idx: number) => {
		const next = value.filter((_, i) => i !== idx);
		onChange(next);
	};

	const update = (idx: number, field: keyof DialogPair, val: string) => {
		const next = value.map((d, i) => (i === idx ? { ...d, [field]: val } : d));
		onChange(next);
	};

	return (
		<fieldset className="border border-border rounded-lg p-4">
			<legend className="text-sm font-semibold text-foreground px-1">示例对话</legend>
			<p className="text-xs text-muted-foreground mb-3">供 LLM 参考的 QA 对，帮助模型理解患者回答风格</p>
			{value.length > 0 && (
				<div className="space-y-3 mb-3">
					{value.map((d, i) => (
						<div key={i} className="flex items-start gap-2 p-3 rounded-lg border border-border">
							<div className="flex-1 space-y-2">
								<div>
									<label className="text-[10px] text-muted-foreground">护士问</label>
									<textarea
										value={d.question}
										onChange={(e) => update(i, "question", e.target.value)}
										className={`${inputClass} h-14 resize-y`}
										disabled={disabled}
									/>
								</div>
								<div>
									<label className="text-[10px] text-muted-foreground">患者答</label>
									<textarea
										value={d.answer}
										onChange={(e) => update(i, "answer", e.target.value)}
										className={`${inputClass} h-14 resize-y`}
										disabled={disabled}
									/>
								</div>
							</div>
							<button type="button" onClick={() => remove(i)} disabled={disabled} className="p-1.5 text-muted-foreground hover:text-destructive transition-colors shrink-0">
								<Trash2 size={14} />
							</button>
						</div>
					))}
				</div>
			)}
			{!disabled && (
				<button type="button" onClick={add} className="flex items-center gap-1 text-xs text-primary hover:bg-primary/10 px-2 py-1 rounded transition-colors">
					<Plus size={12} /> 添加对话
				</button>
			)}
		</fieldset>
	);
}
