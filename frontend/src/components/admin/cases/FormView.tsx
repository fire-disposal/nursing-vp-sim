import type { CaseDispatch, CaseEditorState } from "./CaseEditorState";
import type { PhaseFormData } from "./caseFormTypes";
import { arrayField, numField, objField, stringField } from "./CaseEditorState";
import { AiFieldsSection } from "./AiFieldsSection";
import { BackgroundEditor } from "./BackgroundEditor";
import CapabilitiesEditor from "./CapabilitiesEditor";
import { ClinicalSection } from "./ClinicalSection";
import { ExamAnchorsEditor } from "./ExamAnchorsEditor";
import { PatientSection } from "./PatientSection";
import { PersonalitySection } from "./PersonalitySection";
import { PhasesEditor } from "./PhasesEditor";
import { QuizEditor } from "./QuizEditor";
import { Checkbox, NumberInput, Paper, Select, SimpleGrid, Stack, Text, TextInput, Textarea } from "@mantine/core";

interface Props {
	state: CaseEditorState;
	dispatch: CaseDispatch;
	disabled?: boolean;
}

export function FormView({ state, dispatch, disabled }: Props) {

	function set(path: string, value: unknown) {
		dispatch({ type: "SET_FIELD", path, value });
	}

	const name = stringField(state, "name");
	const difficulty = numField(state, "difficulty", 1);
	const timeLimit = numField(state, "time_limit", 20);
	const description = stringField(state, "description");
	const isOpen = Boolean(state.json.is_open);

	return (
		<Stack gap="md">
			{/* ── Basic Info ── */}
			<Paper withBorder p="md" radius="md">
				<Text size="sm" fw={500} mb="md">基本信息</Text>
				<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
					<div>
						<Text size="xs" c="dimmed" mb={4}>病例名称</Text>
						<TextInput value={name} onChange={(e) => set("name", e.currentTarget.value)} disabled={disabled} placeholder="例：急性阑尾炎" />
					</div>
					<div>
						<Text size="xs" c="dimmed" mb={4}>难度</Text>
						<Select
							data={[{ value: "1", label: "初级" }, { value: "2", label: "中级" }, { value: "3", label: "高级" }]}
							value={String(difficulty)}
							onChange={(v) => set("difficulty", Number(v ?? "1"))}
							disabled={disabled}
						/>
					</div>
					<div>
						<Text size="xs" c="dimmed" mb={4}>时间限制（分钟）</Text>
						<NumberInput value={timeLimit} onChange={(v) => set("time_limit", Number(v))} disabled={disabled} min={1} max={180} />
					</div>
				</SimpleGrid>
				<div style={{ marginTop: 12 }}>
					<Text size="xs" c="dimmed" mb={4}>描述</Text>
					<Textarea value={description} onChange={(e) => set("description", e.currentTarget.value)} disabled={disabled} placeholder="病例简述…" autosize minRows={2} />
				</div>
				<Checkbox checked={isOpen} onChange={(e) => set("is_open", e.currentTarget.checked)} disabled={disabled} label="是否开放" mt="md" />
			</Paper>

			<PatientSection state={state} dispatch={dispatch} disabled={disabled} />
			<PersonalitySection state={state} dispatch={dispatch} disabled={disabled} />

			<ClinicalSection state={state} dispatch={dispatch} disabled={disabled} />
			<Stack gap="md">
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

				<QuizEditor
					value={objField(state, "tools.quiz", { title: "", questions: [] }) as never}
					onChange={(v) => set("tools.quiz", v)}
					disabled={disabled}
				/>
				<PhasesEditor
					value={objField(state, "phases", [] as never) as unknown as Array<PhaseFormData>}
					onChange={(v) => set("phases", v)}
					disabled={disabled}
				/>
			</Stack>
		</Stack>
	);
}
