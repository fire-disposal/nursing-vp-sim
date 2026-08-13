import type { CaseDispatch, CaseJsonValue } from "./CaseEditorState";
import { boolField } from "./CaseEditorState";
import type { CaseEditorState } from "./CaseEditorState";
import { Checkbox, Group, SimpleGrid, Stack, Text } from "@mantine/core";

const TOOL_LIST: { key: string; label: string; desc: string }[] = [
	{ key: "physical_exam", label: "护理查体", desc: "学生可进行虚拟体格检查" },
	{ key: "nursing_diagnosis", label: "护理诊断", desc: "NANDA 护理诊断制定与排序" },
	{ key: "nursing_record", label: "护理记录", desc: "生成结构化 ADPIE 护理记录" },
	{ key: "quiz", label: "引导题目", desc: "训练中弹出选择题/判断题" },
];

interface Props {
	state: CaseEditorState;
	dispatch: CaseDispatch;
}

export default function CapabilitiesEditor({ state, dispatch }: Props) {
	const tools = (state.json.tools as Record<string, CaseJsonValue> | undefined) ?? {};

	function toggle(key: string) {
		const current = { ...tools };
		current[key] = !current[key];
		dispatch({ type: "SET_FIELD", path: "tools", value: current });
	}

	return (
		<Stack gap={8}>
			<Text size="xs" fw={500} c="dimmed">训练工具</Text>
			<SimpleGrid cols={{ base: 1, sm: 2 }} spacing={8}>
				{TOOL_LIST.map((c) => {
					const enabled = boolField(state, `tools.${c.key}`);
					return (
						<Checkbox.Card key={c.key} checked={enabled} onClick={() => toggle(c.key)} radius="md">
							<Group wrap="nowrap" align="flex-start" gap={8}>
								<Checkbox.Indicator />
								<div>
									<Text size="xs" fw={500}>{c.label}</Text>
									<Text size="xs" c="dimmed" lh={1.2}>{c.desc}</Text>
								</div>
							</Group>
						</Checkbox.Card>
					);
				})}
			</SimpleGrid>
		</Stack>
	);
}
