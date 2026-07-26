import type { CaseDispatch, CaseEditorState, CaseJsonValue } from "./CaseEditorState";
import { arrayField, numField, objField, stringField } from "./CaseEditorState";
import { AiFieldsSection } from "./AiFieldsSection";
import { BackgroundEditor } from "./BackgroundEditor";
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
				<legend className="text-sm font-medium px-1">基本信息</legend>
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div className="space-y-1">
						<label className="text-xs text-muted-foreground">病例名称</label>
						<input className={inputClass} value={name} onChange={(e) => set("name", e.target.value)} disabled={disabled} placeholder="例：急性阑尾炎" />
					</div>
					<div className="space-y-1">
						<label className="text-xs text-muted-foreground">难度</label>
						<select className={inputClass} value={difficulty} onChange={(e) => set("difficulty", Number(e.target.value))} disabled={disabled}>
							<option value={1}>初级</option><option value={2}>中级</option><option value={3}>高级</option>
						</select>
					</div>
					<div className="space-y-1">
						<label className="text-xs text-muted-foreground">时间限制（分钟）</label>
						<input className={inputClass} type="number" value={timeLimit} onChange={(e) => set("time_limit", Number(e.target.value))} disabled={disabled} min={1} max={180} />
					</div>
					<div className="space-y-1">
						<label className="text-xs text-muted-foreground">训练类型</label>
						<select className={inputClass} value={trainingType} onChange={(e) => set("training_type", e.target.value)} disabled={disabled}>
							<option value="history_taking">病史采集</option><option value="triage">预检分诊</option>
						</select>
					</div>
				</div>
				<div className="mt-3 space-y-1">
					<label className="text-xs text-muted-foreground">描述</label>
					<textarea className={inputClass} rows={2} value={description} onChange={(e) => set("description", e.target.value)} disabled={disabled} placeholder="病例简述…" />
				</div>
				<div className="mt-3 flex items-center gap-2">
					<label className="text-xs text-muted-foreground">是否开放</label>
					<input type="checkbox" checked={isOpen} onChange={(e) => set("is_open", e.target.checked)} disabled={disabled} />
				</div>
			</fieldset>

			<PatientSection state={state} dispatch={dispatch} disabled={disabled} />
			<PersonalitySection state={state} dispatch={dispatch} disabled={disabled} />

			{trainingType === "triage" ? (
				<TriageSection state={state} dispatch={dispatch} disabled={disabled} />
			) : (
				<ClinicalSection state={state} dispatch={dispatch} disabled={disabled} />
			)}

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
					value={objField(state, "tools.physical_exam") as Record<string, string>}
					onChange={(v) => set("tools.physical_exam", v)}
					disabled={disabled}
				/>

				<BackgroundEditor
					value={objField(state, "deep_background") as Record<string, string>}
					onChange={(v) => set("deep_background", v)}
					disabled={disabled}
				/>

				{trainingType === "triage" ? null : (
					<>
						<QuizEditor
							value={objField(state, "tools.quiz", { title: "", questions: [] }) as never}
							onChange={(v) => set("tools.quiz", v)}
							disabled={disabled}
						/>
						<PhasesEditor
							value={objField(state, "phases", [] as never) as unknown as Array<import("./caseFormTypes").PhaseFormData>}
							onChange={(v) => set("phases", v)}
							disabled={disabled}
						/>
						<DialoguesEditor
							value={objField(state, "example_dialogues", [] as never) as unknown as Array<{ question: string; answer: string }>}
							onChange={(v) => set("example_dialogues", v)}
							disabled={disabled}
						/>
					</>
				)}
			</div>
		</div>
	);
}
