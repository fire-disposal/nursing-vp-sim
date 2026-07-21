import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { PhaseFormData } from "./caseFormTypes";
import { emptyPhase } from "./caseFormTypes";
import { inputClass } from "@/utils/styles";

interface Props {
	value: PhaseFormData[];
	onChange: (v: PhaseFormData[]) => void;
	disabled?: boolean;
}

export function PhasesEditor({ value, onChange, disabled }: Props) {
	const [expanded, setExpanded] = useState<Set<number>>(new Set());

	const toggle = (idx: number) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(idx)) next.delete(idx); else next.add(idx);
			return next;
		});
	};

	const add = () => {
		onChange([...value, emptyPhase(value.length)]);
	};

	const remove = (idx: number) => {
		onChange(value.filter((_, i) => i !== idx));
	};

	const update = (idx: number, fn: (p: PhaseFormData) => PhaseFormData) => {
		onChange(value.map((p, i) => (i === idx ? fn(p) : p)));
	};

	return (
		<fieldset className="border border-border rounded-lg p-4">
			<legend className="text-sm font-semibold text-foreground px-1">训练阶段</legend>
			<p className="text-xs text-muted-foreground mb-3">定义多阶段训练流程。每阶段可配置过渡条件和操作集</p>
			{value.length > 0 && (
				<div className="space-y-2 mb-3">
					{value.map((p, i) => {
						const isOpen = expanded.has(i);
						return (
							<div key={p.id} className="border border-border rounded-lg overflow-hidden">
								<button type="button" onClick={() => toggle(i)} className="flex items-center justify-between w-full px-3 py-2 bg-muted/30 hover:bg-muted transition-colors text-left">
									<span className="text-xs font-medium">{p.name || `Phase ${i + 1}`}</span>
									{isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
								</button>
								{isOpen && (
									<div className="p-3 space-y-2">
										<div className="flex gap-2">
											<input value={p.id} onChange={(e) => update(i, (p) => ({ ...p, id: e.target.value }))} className={`${inputClass} flex-1`} disabled={disabled} placeholder="ID" />
											<input value={p.name} onChange={(e) => update(i, (p) => ({ ...p, name: e.target.value }))} className={`${inputClass} flex-[2]`} disabled={disabled} placeholder="名称" />
											<input type="number" value={p.order} onChange={(e) => update(i, (p) => ({ ...p, order: Number(e.target.value) }))} className={`${inputClass} w-20`} disabled={disabled} />
										</div>
										<div>
											<label className="text-[10px] text-muted-foreground">Prompt 配置</label>
											<select value={p.prompt_profile} onChange={(e) => update(i, (p) => ({ ...p, prompt_profile: e.target.value }))} className={`${inputClass} h-8 text-xs`} disabled={disabled}>
												<option value="patient_chat">patient_chat</option>
											</select>
										</div>
										<div className="border-t border-border pt-2">
											<label className="text-[10px] text-muted-foreground block mb-1">过渡条件</label>
											<div className="grid grid-cols-2 gap-2">
												<label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={p.transition.auto} onChange={(e) => update(i, (p) => ({ ...p, transition: { ...p.transition, auto: e.target.checked } }))} disabled={disabled} /> 自动过渡</label>
												<div><span className="text-[10px] text-muted-foreground">最小消息数</span><input type="number" value={p.transition.min_messages} onChange={(e) => update(i, (p) => ({ ...p, transition: { ...p.transition, min_messages: Number(e.target.value) } }))} className={`${inputClass} h-8 text-xs`} disabled={disabled} /></div>
												<div><span className="text-[10px] text-muted-foreground">最小操作数</span><input type="number" value={p.transition.min_operations} onChange={(e) => update(i, (p) => ({ ...p, transition: { ...p.transition, min_operations: Number(e.target.value) } }))} className={`${inputClass} h-8 text-xs`} disabled={disabled} /></div>
												<div><span className="text-[10px] text-muted-foreground">消息后自动</span><input type="number" value={p.transition.auto_after_messages} onChange={(e) => update(i, (p) => ({ ...p, transition: { ...p.transition, auto_after_messages: Number(e.target.value) } }))} className={`${inputClass} h-8 text-xs`} disabled={disabled} /></div>
											</div>
										</div>
										<button type="button" onClick={() => remove(i)} disabled={disabled} className="flex items-center gap-1 text-xs text-destructive hover:underline"><Trash2 size={12} /> 删除阶段</button>
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
			{!disabled && (
				<button type="button" onClick={add} className="flex items-center gap-1 text-xs text-primary hover:bg-primary/10 px-2 py-1 rounded transition-colors"><Plus size={12} /> 添加阶段</button>
			)}
		</fieldset>
	);
}
