import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { inputClass } from "@/utils/styles";

interface Props {
	value: Record<string, string>;
	onChange: (v: Record<string, string>) => void;
	disabled?: boolean;
}

export function ExamAnchorsEditor({ value, onChange, disabled }: Props) {
	const entries = Object.entries(value);
	const [newKey, setNewKey] = useState("");
	const [newVal, setNewVal] = useState("");

	const add = () => {
		const k = newKey.trim();
		if (!k) return;
		onChange({ ...value, [k]: newVal.trim() });
		setNewKey("");
		setNewVal("");
	};

	const remove = (key: string) => {
		const next = { ...value };
		delete next[key];
		onChange(next);
	};

	const setVal = (key: string, val: string) => {
		onChange({ ...value, [key]: val });
	};

	return (
		<fieldset className="border border-border rounded-lg p-4">
			<legend className="text-sm font-semibold text-foreground px-1">查体锚点</legend>
			<p className="text-xs text-muted-foreground mb-3">定义各检查项的正常范围值。支持范围格式如 "36.8-37.2"</p>
			{entries.length > 0 && (
				<div className="space-y-2 mb-3">
					{entries.map(([k, v]) => (
						<div key={k} className="flex items-center gap-2">
							<input value={k} className={`${inputClass} flex-1`} disabled placeholder="key" />
							<input value={v} onChange={(e) => setVal(k, e.target.value)} className={`${inputClass} flex-[2]`} disabled={disabled} placeholder="value" />
							<button type="button" onClick={() => remove(k)} disabled={disabled} className="p-2 text-muted-foreground hover:text-destructive transition-colors shrink-0">
								<Trash2 size={14} />
							</button>
						</div>
					))}
				</div>
			)}
			{!disabled && (
				<div className="flex items-center gap-2">
					<input value={newKey} onChange={(e) => setNewKey(e.target.value)} className={`${inputClass} flex-1`} placeholder="新 key" />
					<input value={newVal} onChange={(e) => setNewVal(e.target.value)} className={`${inputClass} flex-[2]`} placeholder="value" />
					<button type="button" onClick={add} className="p-2 text-primary hover:bg-primary/10 rounded transition-colors shrink-0"><Plus size={14} /></button>
				</div>
			)}
		</fieldset>
	);
}
