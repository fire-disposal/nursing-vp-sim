import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { QuizFormData, QuizQuestion } from "./caseFormTypes";
import { emptyQuizOption, emptyQuizQuestion } from "./caseFormTypes";
import { inputClass } from "@/utils/styles";

interface Props {
	value: QuizFormData;
	onChange: (v: QuizFormData) => void;
	disabled?: boolean;
}

export function QuizEditor({ value, onChange, disabled }: Props) {
	const [expanded, setExpanded] = useState<Set<string>>(new Set());

	const toggle = (id: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id); else next.add(id);
			return next;
		});
	};

	const setTitle = (t: string) => onChange({ ...value, title: t });

	const updateQuestion = (idx: number, fn: (q: QuizQuestion) => QuizQuestion) => {
		const next = value.questions.map((q, i) => (i === idx ? fn(q) : q));
		onChange({ ...value, questions: next });
	};

	const addQuestion = () => {
		onChange({ ...value, questions: [...value.questions, emptyQuizQuestion()] });
	};

	const removeQuestion = (idx: number) => {
		onChange({ ...value, questions: value.questions.filter((_, i) => i !== idx) });
	};

	const addOption = (qIdx: number) => {
		updateQuestion(qIdx, (q) => ({ ...q, options: [...q.options, emptyQuizOption()] }));
	};

	const removeOption = (qIdx: number, oIdx: number) => {
		updateQuestion(qIdx, (q) => ({ ...q, options: q.options.filter((_, i) => i !== oIdx) }));
	};

	return (
		<fieldset className="border border-border rounded-lg p-4">
			<legend className="text-sm font-semibold text-foreground px-1">引导题目</legend>
			<p className="text-xs text-muted-foreground mb-3">训练中穿插的选择题，帮助学生聚焦关键知识点。不参与评分</p>
			<div className="mb-3">
				<label className="block text-xs font-semibold text-muted-foreground mb-1">标题</label>
				<input value={value.title} onChange={(e) => setTitle(e.target.value)} placeholder="如：课前自测" className={inputClass} disabled={disabled} />
			</div>

			{value.questions.length > 0 && (
				<div className="space-y-2 mb-3">
					{value.questions.map((q, qi) => {
						const isOpen = expanded.has(q.id);
						return (
							<div key={q.id} className="border border-border rounded-lg overflow-hidden">
								<button type="button" onClick={() => toggle(q.id)} className="flex items-center justify-between w-full px-3 py-2 bg-muted/30 hover:bg-muted transition-colors text-left">
									<span className="text-xs font-medium truncate flex-1 mr-2">
										Q{qi + 1}{q.stem ? ` — ${q.stem.slice(0, 40)}${q.stem.length > 40 ? "…" : ""}` : " (待编辑)"}
									</span>
									<div className="flex items-center gap-1 shrink-0">
										<span className="text-[10px] text-muted-foreground">{q.options.length} 选项 · 答案 {q.answer || "?"}</span>
										{isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
									</div>
								</button>
								{isOpen && (
									<div className="p-3 space-y-2">
										<textarea value={q.stem} onChange={(e) => updateQuestion(qi, (q) => ({ ...q, stem: e.target.value }))} placeholder="题目标题" className={`${inputClass} h-16 resize-y`} disabled={disabled} />
										<div className="space-y-1">
											{q.options.map((opt, oi) => (
												<div key={oi} className="flex items-center gap-2">
													<input value={opt.key} onChange={(e) => updateQuestion(qi, (q) => ({ ...q, options: q.options.map((o, j) => (j === oi ? { ...o, key: e.target.value } : o)) }))} className={`${inputClass} w-16 text-center`} disabled={disabled} placeholder="A" />
													<input value={opt.text} onChange={(e) => updateQuestion(qi, (q) => ({ ...q, options: q.options.map((o, j) => (j === oi ? { ...o, text: e.target.value } : o)) }))} className={`${inputClass} flex-1`} disabled={disabled} placeholder="选项文本" />
													<button type="button" onClick={() => removeOption(qi, oi)} disabled={disabled} className="p-1 text-muted-foreground hover:text-destructive"><Trash2 size={12} /></button>
												</div>
											))}
											{!disabled && <button type="button" onClick={() => addOption(qi)} className="text-[10px] text-primary hover:underline"><Plus size={10} className="inline" /> 添加选项</button>}
										</div>
										<div className="flex items-center gap-3">
											<div className="flex-1">
												<label className="text-[10px] text-muted-foreground">正确答案</label>
												<select value={q.answer} onChange={(e) => updateQuestion(qi, (q) => ({ ...q, answer: e.target.value }))} className={`${inputClass} h-8 text-xs`} disabled={disabled}>
													<option value="">--</option>
													{q.options.map((o) => <option key={o.key} value={o.key}>{o.key}{o.text ? ` — ${o.text}` : ""}</option>)}
												</select>
											</div>
											<button type="button" onClick={() => removeQuestion(qi)} disabled={disabled} className="p-1.5 text-muted-foreground hover:text-destructive shrink-0 self-end mb-0.5"><Trash2 size={14} /></button>
										</div>
										<textarea value={q.explanation} onChange={(e) => updateQuestion(qi, (q) => ({ ...q, explanation: e.target.value }))} placeholder="答案解析（选填）" className={`${inputClass} h-14 resize-y`} disabled={disabled} />
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
			{!disabled && (
				<button type="button" onClick={addQuestion} className="flex items-center gap-1 text-xs text-primary hover:bg-primary/10 px-2 py-1 rounded transition-colors">
					<Plus size={12} /> 添加题目
				</button>
			)}
		</fieldset>
	);
}
