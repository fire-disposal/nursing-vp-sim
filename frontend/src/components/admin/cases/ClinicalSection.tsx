import type { CaseDispatch, CaseEditorState } from "./CaseEditorState";
import { stringField } from "./CaseEditorState";
import { Group, Paper, SimpleGrid, Stack, Text, TextInput, Textarea } from "@mantine/core";

const HISTORY_FIELDS: { key: string; label: string; minRows: number }[] = [
	{ key: "present_illness", label: "现病史", minRows: 4 },
	{ key: "past_history", label: "既往史", minRows: 3 },
	{ key: "medication_history", label: "用药史", minRows: 3 },
	{ key: "allergy_history", label: "过敏史", minRows: 2 },
	{ key: "family_history", label: "家族史", minRows: 3 },
	{ key: "social_history", label: "生活史", minRows: 3 },
];

interface Props {
	state: CaseEditorState;
	dispatch: CaseDispatch;
	disabled?: boolean;
}

export function ClinicalSection({ state, dispatch, disabled }: Props) {
	const voiceType = stringField(state, "voice_type");
	const voiceOverride = stringField(state, "voice_override");
	const chiefComplaint = stringField(state, "chief_complaint");
	const openingLine = stringField(state, "opening_line");

	function set(path: string, value: unknown) {
		dispatch({ type: "SET_FIELD", path, value });
	}

	return (
		<Paper withBorder p="md" radius="md">
			<Text size="sm" fw={600} mb="md">临床信息</Text>

			{/* ── Voice ── */}
			<Group gap="sm" grow wrap="wrap" mb="md" pb="md" style={{ borderBottom: "1px solid var(--mantine-color-gray-3)" }}>
				<div>
					<Text size="xs" fw={600} c="dimmed" mb={4}>
						音色 ID <Text component="span" size="xs" fw={400}>（留空则按年龄性别自动分流）</Text>
					</Text>
					<TextInput value={voiceType} onChange={(e) => set("voice_type", e.currentTarget.value)} placeholder="zh_female_vv_uranus_bigtts" disabled={disabled} />
				</div>
				<div>
					<Text size="xs" fw={600} c="dimmed" mb={4}>强制音色覆盖</Text>
					<TextInput value={voiceOverride} onChange={(e) => set("voice_override", e.currentTarget.value)} placeholder="zh_male_wennuan_bigtts" disabled={disabled} />
				</div>
			</Group>

			{/* ── Chief complaint ── */}
			<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm" mb="md">
				<div>
					<Text size="xs" fw={600} c="dimmed" mb={4}>主诉<Text component="span" c="red">*</Text></Text>
					<TextInput value={chiefComplaint} onChange={(e) => set("chief_complaint", e.currentTarget.value)} disabled={disabled} />
				</div>
				<div>
					<Text size="xs" fw={600} c="dimmed" mb={4}>开场问候</Text>
					<TextInput value={openingLine} onChange={(e) => set("opening_line", e.currentTarget.value)} disabled={disabled} />
				</div>
			</SimpleGrid>

			{/* ── History fields ── */}
			<Stack gap="sm">
				{HISTORY_FIELDS.map(({ key, label, minRows }) => (
					<div key={key}>
						<Text size="xs" fw={600} c="dimmed" mb={4}>{label}</Text>
						<Textarea value={stringField(state, key)} onChange={(e) => set(key, e.currentTarget.value)} autosize minRows={minRows} disabled={disabled} />
					</div>
				))}
			</Stack>
		</Paper>
	);
}
