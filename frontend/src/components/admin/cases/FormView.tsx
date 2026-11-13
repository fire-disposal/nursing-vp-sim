import { Accordion, Badge, Group, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";
import { AiFieldsSection } from "./AiFieldsSection";
import BlueprintEditor from "./BlueprintEditor";
import CapabilitiesEditor from "./CapabilitiesEditor";
import { CaseBasicsSection } from "./CaseBasicsSection";
import type { CaseDispatch, CaseEditorState } from "./CaseEditorState";
import { arrayField, objField, stringField } from "./CaseEditorState";
import { KeyValueEditor } from "./KeyValueEditor";
import { PatientSection } from "./PatientSection";
import { PersonalitySection } from "./PersonalitySection";
import { QuizEditor } from "./QuizEditor";

interface Props {
	state: CaseEditorState;
	dispatch: CaseDispatch;
	disabled?: boolean;
}

function EditorSection({
	value,
	title,
	summary,
	children,
}: {
	value: string;
	title: string;
	summary: string;
	children: ReactNode;
}) {
	return (
		<Accordion.Item value={value}>
			<Accordion.Control>
				<Group justify="space-between" gap="sm" wrap="nowrap" style={{ flex: 1 }}>
					<Text size="sm" fw={500}>{title}</Text>
					<Badge variant="light" color="gray" size="sm">{summary}</Badge>
				</Group>
			</Accordion.Control>
			<Accordion.Panel>{children}</Accordion.Panel>
		</Accordion.Item>
	);
}

export function FormView({ state, dispatch, disabled }: Props) {
	function set(path: string, value: unknown) {
		dispatch({ type: "SET_FIELD", path, value });
	}

	const activityCount = Object.keys(objField(state, "activities")).length;
	const inquiryCount = arrayField(state, "required_inquiries").length;
	const hiddenCount = arrayField(state, "hidden_info").length;
	const blueprintEnabled = Object.keys(objField(state, "blueprint")).length > 0;
	const examCount = Object.keys(objField(state, "activities.physical_exam.config.vital_signs")).length;
	const backgroundCount = Object.keys(objField(state, "deep_background")).length;
	const quizCount = arrayField(state, "activities.quiz.config.questions").length;

	return (
		<Stack gap="md">
			<CaseBasicsSection state={state} dispatch={dispatch} disabled={disabled} />
			<PatientSection state={state} dispatch={dispatch} disabled={disabled} />

			<Accordion multiple variant="separated" chevronPosition="right">
				<EditorSection value="personality" title="人格与沟通" summary={stringField(state, "communication_style").trim() ? "已填写" : "可选"}>
					<PersonalitySection state={state} dispatch={dispatch} disabled={disabled} />
				</EditorSection>

				<EditorSection value="capabilities" title="训练能力" summary={`${activityCount} 项已启用`}>
					<CapabilitiesEditor state={state} dispatch={dispatch} disabled={disabled} />
				</EditorSection>

				<EditorSection value="inquiry" title="问诊任务" summary={`${inquiryCount} 必询 · ${hiddenCount} 隐藏`}>
					<AiFieldsSection
						hiddenInfo={arrayField(state, "hidden_info", []) as string[]}
						requiredInquiries={arrayField(state, "required_inquiries", []) as string[]}
						onHiddenInfoChange={(v) => set("hidden_info", v)}
						onRequiredInquiriesChange={(v) => set("required_inquiries", v)}
						disabled={disabled}
					/>
				</EditorSection>

				<EditorSection value="blueprint" title="教学蓝图" summary={blueprintEnabled ? "已启用" : "未启用"}>
					<BlueprintEditor state={state} dispatch={dispatch} disabled={disabled} />
				</EditorSection>

				<EditorSection value="exam" title="查体与背景" summary={`${examCount} 查体 · ${backgroundCount} 背景`}>
					<Stack gap="md">
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
					</Stack>
				</EditorSection>

				<EditorSection value="quiz" title="随堂测验" summary={`${quizCount} 题`}>
					<QuizEditor
						value={objField(state, "activities.quiz.config", { title: "", questions: [] }) as never}
						onChange={(v) => set("activities.quiz.config", v)}
						disabled={disabled}
					/>
				</EditorSection>
			</Accordion>
		</Stack>
	);
}
