import { Stack } from "@mantine/core";
import { AiFieldsSection } from "./AiFieldsSection";
import BlueprintEditor from "./BlueprintEditor";
import CapabilitiesEditor from "./CapabilitiesEditor";
import { CaseBasicsSection } from "./CaseBasicsSection";
import type { CaseDispatch, CaseEditorState } from "./CaseEditorState";
import { arrayField, objField } from "./CaseEditorState";
import { KeyValueEditor } from "./KeyValueEditor";
import { PatientSection } from "./PatientSection";
import { PersonalitySection } from "./PersonalitySection";
import { QuizEditor } from "./QuizEditor";

interface Props {
	state: CaseEditorState;
	dispatch: CaseDispatch;
	disabled?: boolean;
}

export function FormView({ state, dispatch, disabled }: Props) {

	function set(path: string, value: unknown) {
		dispatch({ type: "SET_FIELD", path, value });
	}

	return (
		<Stack gap="md">
			{/* ── Basic Info ── */}
			<CaseBasicsSection state={state} dispatch={dispatch} disabled={disabled} />

			<PatientSection state={state} dispatch={dispatch} disabled={disabled} />
			<PersonalitySection state={state} dispatch={dispatch} disabled={disabled} />

			<Stack gap="md">
				<CapabilitiesEditor state={state} dispatch={dispatch} disabled={disabled} />
				<AiFieldsSection
					hiddenInfo={arrayField(state, "hidden_info", []) as string[]}
					requiredInquiries={arrayField(state, "required_inquiries", []) as string[]}
					onHiddenInfoChange={(v) => set("hidden_info", v)}
					onRequiredInquiriesChange={(v) => set("required_inquiries", v)}
					disabled={disabled}
				/>

				{/* 教学蓝图：缺失时不写入任何键，须由作者显式启用 */}
				<BlueprintEditor state={state} dispatch={dispatch} disabled={disabled} />

				<KeyValueEditor
					title="查体锚点"
					description='定义各检查项的正常范围值。支持范围格式如 "36.8-37.2"'
					actionLabel="查体锚点"
					value={objField(state, "activities.physical_exam.config.vital_signs") as Record<string, string>}
					onChange={(v) => set("activities.physical_exam.config.vital_signs", v)}
					disabled={disabled}
				/>

				<KeyValueEditor
					title="隐藏背景"
					description="LLM 内部上下文，患者不会主动透露的数据。如吸烟史、职业暴露等"
					actionLabel="背景项"
					value={objField(state, "deep_background") as Record<string, string>}
					onChange={(v) => set("deep_background", v)}
					disabled={disabled}
					multiline
				/>

				<QuizEditor
					value={objField(state, "activities.quiz.config", { title: "", questions: [] }) as never}
					onChange={(v) => set("activities.quiz.config", v)}
					disabled={disabled}
				/>
			</Stack>
		</Stack>
	);
}
