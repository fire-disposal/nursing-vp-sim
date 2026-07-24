import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { CaseDispatch } from "./CaseEditorState";
import { arrayField, numField, objField, stringField } from "./CaseEditorState";
import type { CaseEditorState } from "./CaseEditorState";
import { AiFieldsSection } from "./AiFieldsSection";
import CapabilitiesEditor from "./CapabilitiesEditor";
import { ClinicalSection } from "./ClinicalSection";
import { DialoguesEditor } from "./DialoguesEditor";
import { ExamAnchorsEditor } from "./ExamAnchorsEditor";
import { PatientSection } from "./PatientSection";
import { PersonalitySection } from "./PersonalitySection";
import { PhasesEditor } from "./PhasesEditor";
import { QuizEditor } from "./QuizEditor";
import { TriageSection } from "./TriageSection";
import { inputClass } from "@/utils/styles";

interface Props {
	state: CaseEditorState;
	dispatch: CaseDispatch;
	disabled?: boolean;
}

export function FormView({ state, dispatch, disabled }: Props) {
	const [showExtended, setShowExtended] = useState(false);
	const trainingType = stringField(state, "training_type", "history_taking");

	function set(path: string, value: unknown) {
		dispatch({ type: "SET_FIELD", path, value });
	}

	const name = stringField(state, "name");
	const difficulty = numField(state, "difficulty", 1);
	const timeLimit = numField(state, "time_limit", 20);
	const description = stringField(state, "description");
	const isOpen = Boolean(state.json.is_open);

	return (
		<div className="space-y-4">
			{/* ── Basic Info ── */}
			<fieldset className="border border-border rounded-lg p-4">
				<legend className="text-sm font-semibold text-foreground px-1">基本信息</legend>
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
					<div>
						<label className="block text-xs font-semibold text-muted-foreground mb-1">病例名称<span className="text-destructive ml-0.5">*</span></label>
						<input value={name} onChange={(e) => set("name", e.target.value)} className={inputClass} disabled={disabled} />
					</div>
					<div>
						<label className="block text-xs font-semibold text-muted-foreground mb-1">训练类型</label>
						<select value={trainingType} onChange={(e) => set("training_type", e.target.value)} className={inputClass} disabled={disabled}>
							<option value="history_taking">病史采集</option>
							<option value="triage">分诊评估</option>
						</select>
					</div>
					<div>
						<label className="block text-xs font-semibold text-muted-foreground mb-1">难度 (1-3)<span className="text-destructive ml-0.5">*</span></label>
						<select value={difficulty} onChange={(e) => set("difficulty", Number(e.target.value))} className={inputClass} disabled={disabled}>
							<option value={1}>1 — 简单</option>
							<option value={2}>2 — 中等</option>
							<option value={3}>3 — 困难</option>
						</select>
					</div>
					<div>
						<label className="block text-xs font-semibold text-muted-foreground mb-1">时间限制 (分)</label>
						<input type="number" min={1} max={180} value={timeLimit} onChange={(e) => set("time_limit", Number(e.target.value))} className={inputClass} disabled={disabled} />
					</div>
				</div>
				<div className="mt-3">
					<label className="block text-xs font-semibold text-muted-foreground mb-1">病例简介</label>
					<textarea value={description} onChange={(e) => set("description", e.target.value)} className={`${inputClass} h-16 resize-y`} disabled={disabled} />
				</div>
				<label className="flex items-center gap-2 mt-2 text-xs text-muted-foreground cursor-pointer">
					<input type="checkbox" checked={isOpen} onChange={(e) => set("is_open", e.target.checked)} className="size-3.5" disabled={disabled} />
					对学生开放
				</label>
			</fieldset>

			<PatientSection state={state} dispatch={dispatch} disabled={disabled} />
			<PersonalitySection state={state} dispatch={dispatch} disabled={disabled} />

			{trainingType === "triage" ? (
				<TriageSection state={state} dispatch={dispatch} disabled={disabled} />
			) : (
				<ClinicalSection state={state} dispatch={dispatch} disabled={disabled} />
			)}

			{/* ── Extended ── */}
			<button
				type="button"
				onClick={() => setShowExtended((v) => !v)}
				className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full py-1"
			>
				{showExtended ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				{showExtended ? "收起高级配置 ▲" : "展开高级配置 ▼"}
			</button>

			{showExtended && (
				<div className="space-y-4">
					<CapabilitiesEditor state={state} dispatch={dispatch} />

					<AiFieldsSection
						hiddenInfo={arrayField(state, "hidden_info", []) as string[]}
						requiredInquiries={arrayField(state, "required_inquiries", []) as string[]}
						onHiddenInfoChange={(v) => set("hidden_info", v)}
						onRequiredInquiriesChange={(v) => set("required_inquiries", v)}
						disabled={disabled}
					/>

					<ExamAnchorsEditor
						value={objField(state, "exam_anchors") as Record<string, string>}
						onChange={(v) => set("exam_anchors", v)}
						disabled={disabled}
					/>

					{trainingType === "triage" ? null : (
						<>
							<QuizEditor
								value={arrayField(state, "quiz", []) as never}
								onChange={(v) => set("quiz", v)}
								disabled={disabled}
							/>
							<PhasesEditor
								value={arrayField(state, "phases", []) as never}
								onChange={(v) => set("phases", v)}
								disabled={disabled}
							/>
							<DialoguesEditor
								value={arrayField(state, "example_dialogues", []) as never}
								onChange={(v) => set("example_dialogues", v)}
								disabled={disabled}
							/>
						</>
					)}
				</div>
			)}
		</div>
	);
}
