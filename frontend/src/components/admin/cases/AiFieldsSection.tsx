import { Plus, X } from "lucide-react";
import { useState } from "react";
import { inputClass } from "@/utils/styles";

interface Props {
	hiddenInfo: string[];
	requiredInquiries: string[];
	onHiddenInfoChange: (v: string[]) => void;
	onRequiredInquiriesChange: (v: string[]) => void;
	disabled?: boolean;
}

function TagEditor({ value, onChange, placeholder, disabled }: { value: string[]; onChange: (v: string[]) => void; placeholder: string; disabled?: boolean }) {
	const [input, setInput] = useState("");

	const add = () => {
		const t = input.trim();
		if (!t) return;
		onChange([...value, t]);
		setInput("");
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") { e.preventDefault(); add(); }
	};

	const remove = (idx: number) => {
		onChange(value.filter((_, i) => i !== idx));
	};

	return (
		<div>
			<div className="flex flex-wrap gap-1 mb-2">
				{value.map((t, i) => (
					<span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-muted text-muted-foreground">
						{t}
						{!disabled && <button type="button" onClick={() => remove(i)} className="hover:text-destructive"><X size={10} /></button>}
					</span>
				))}
			</div>
			{!disabled && (
				<div className="flex gap-2">
					<input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} className={`${inputClass} flex-1`} />
					<button type="button" onClick={add} className="p-1.5 text-primary hover:bg-primary/10 rounded transition-colors"><Plus size={14} /></button>
				</div>
			)}
		</div>
	);
}

export function AiFieldsSection({ hiddenInfo, requiredInquiries, onHiddenInfoChange, onRequiredInquiriesChange, disabled }: Props) {
	return (
		<fieldset className="border border-border rounded-lg p-4">
			<legend className="text-sm font-semibold text-foreground px-1">AI 辅助字段</legend>
			<p className="text-xs text-muted-foreground mb-3">这些字段可由 AI 生成，也可手动编辑</p>
			<div className="space-y-4">
				<div>
					<label className="block text-xs font-semibold text-muted-foreground mb-1">隐藏信息</label>
					<p className="text-[10px] text-muted-foreground/60 mb-1">患者不会主动透露的信息（吸烟史、职业等）</p>
					<TagEditor value={hiddenInfo} onChange={onHiddenInfoChange} placeholder="输入后回车添加" disabled={disabled} />
				</div>
				<div>
					<label className="block text-xs font-semibold text-muted-foreground mb-1">必询要点</label>
					<p className="text-[10px] text-muted-foreground/60 mb-1">学生必须覆盖的问诊条目</p>
					<TagEditor value={requiredInquiries} onChange={onRequiredInquiriesChange} placeholder="输入后回车添加" disabled={disabled} />
				</div>
			</div>
		</fieldset>
	);
}
