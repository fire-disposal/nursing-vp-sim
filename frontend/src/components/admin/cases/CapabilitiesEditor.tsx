import type { CaseDispatch, CaseEditorState, CaseJsonValue } from "./CaseEditorState";
import { objField } from "./CaseEditorState";
import { Checkbox, Group, SimpleGrid, Stack, Text } from "@mantine/core";

/**
 * Activity 声明表（docs/15 §四）：id 与后端 `activities.ACTIVITY_IDS` 一一对应，
 * `config` 是该 Activity 的最小合法默认配置（形状由 modules/cases/validator 把关）：
 * - physical_exam：查体征象键留空 = 未配置 → 后端按患者年龄默认值 + 生理联动补全
 * - quiz：questions 为空，由 QuizEditor 补题；空题目在发布门禁会被点名
 * - nursing_record：布尔 true（与内置病例同形；config 仅为启用声明，无字段消费）
 * - nursing_diagnosis：仅对象；该 Activity 尚无正式产物，发布门禁会给出警告
 */
const ACTIVITY_LIST: { key: string; label: string; desc: string; config: CaseJsonValue }[] = [
	{
		key: "physical_exam",
		label: "护理查体",
		desc: "学生可进行虚拟体格检查",
		config: {
			vital_signs: {
				temperature: "",
				heart_rate: "",
				blood_pressure: "",
				respiratory_rate: "",
				spo2: "",
			},
		},
	},
	{ key: "nursing_diagnosis", label: "护理诊断", desc: "NANDA 护理诊断制定与排序", config: {} },
	{ key: "nursing_record", label: "护理记录", desc: "生成结构化 ADPIE 护理记录", config: true },
	{ key: "quiz", label: "引导题目", desc: "训练中弹出选择题/判断题", config: { title: "", questions: [] } },
];

interface Props {
	state: CaseEditorState;
	dispatch: CaseDispatch;
	disabled?: boolean;
}

/**
 * 启用口径与后端 `activity_availability` 一致：只有 `activities.<id>` 是对象且带
 * 非 null 的 `config` 才算可用（`config: null` / 缺键都不是声明）。
 */
function isDeclared(activities: Record<string, CaseJsonValue>, id: string): boolean {
	const declaration = activities[id];
	if (declaration == null || typeof declaration !== "object" || Array.isArray(declaration)) return false;
	const config = (declaration as Record<string, CaseJsonValue>).config;
	return config !== undefined && config !== null;
}

export default function CapabilitiesEditor({ state, dispatch, disabled }: Props) {
	const activities = objField(state, "activities");

	/** 勾选 = 写入 `activities.<id>.config`；取消勾选 = 删除该声明（仅删键才能置为不可用）。 */
	function setDeclared(id: string, declared: boolean, seed: CaseJsonValue) {
		if (disabled) return;
		const next = { ...activities };
		if (declared) next[id] = { config: seed };
		else delete next[id];
		dispatch({ type: "SET_FIELD", path: "activities", value: next });
	}

	return (
		<Stack gap={8}>
			<Text size="xs" fw={500} c="dimmed">训练工具</Text>
			<Text size="xs" c="dimmed" lh={1.2}>
				勾选即声明 activities.&lt;id&gt;.config；取消勾选会删除该声明，其配置一并移除。
			</Text>
			<SimpleGrid cols={{ base: 1, sm: 2 }} spacing={8}>
				{ACTIVITY_LIST.map((a) => {
					const enabled = isDeclared(activities, a.key);
					return (
						<Checkbox.Card
							key={a.key}
							checked={enabled}
							onClick={() => setDeclared(a.key, !enabled, a.config)}
							disabled={disabled}
							radius="md"
						>
							<Group wrap="nowrap" align="flex-start" gap={8}>
								<Checkbox.Indicator />
								<div>
									<Text size="xs" fw={500}>{a.label}</Text>
									<Text size="xs" c="dimmed" lh={1.2}>{a.desc}</Text>
								</div>
							</Group>
						</Checkbox.Card>
					);
				})}
			</SimpleGrid>
		</Stack>
	);
}
