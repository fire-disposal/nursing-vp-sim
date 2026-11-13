import { NumberInput, Paper, Select, SimpleGrid, Text, Textarea, TextInput } from "@mantine/core";
import type { CaseDispatch, CaseEditorState } from "./CaseEditorState";
import { numField, stringField } from "./CaseEditorState";

interface Props {
	state: CaseEditorState;
	dispatch: CaseDispatch;
	disabled?: boolean;
}

/**
 * 病例列级元数据（name / difficulty / time_limit / description）——
 * 四种工作区共用同一组列字段，问诊（``FormView``）与临床判断（``ClinicalReasoningEditor``）
 * 都渲染这一份，避免两处各自维护「难度只接受 1/2/3」之类的口径。
 *
 * 这里不做任何校验：取值范围由后端 ``cases`` 列与保存接口负责。
 */
export function CaseBasicsSection({ state, dispatch, disabled }: Props) {
	function set(path: string, value: unknown) {
		dispatch({ type: "SET_FIELD", path, value });
	}

	const name = stringField(state, "name");
	const difficulty = numField(state, "difficulty", 1);
	const timeLimit = numField(state, "time_limit", 30);
	const description = stringField(state, "description");

	return (
		<Paper withBorder p="md">
			<Text size="sm" fw={500} mb="md">基本信息</Text>
			<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
				<div>
					<Text size="xs" c="dimmed" mb={4}>病例名称</Text>
					<TextInput
						value={name}
						onChange={(e) => set("name", e.currentTarget.value)}
						disabled={disabled}
						placeholder="例：急性阑尾炎"
						aria-label="病例名称"
					/>
				</div>
				<div>
					<Text size="xs" c="dimmed" mb={4}>难度</Text>
					<Select
						data={[{ value: "1", label: "初级" }, { value: "2", label: "中级" }, { value: "3", label: "高级" }]}
						value={String(difficulty)}
						onChange={(v) => set("difficulty", Number(v ?? "1"))}
						disabled={disabled}
						aria-label="难度"
					/>
				</div>
				<div>
					<Text size="xs" c="dimmed" mb={4}>时间限制（分钟）</Text>
					<NumberInput
						value={timeLimit}
						onChange={(v) => set("time_limit", Number(v))}
						disabled={disabled}
						min={30}
						max={180}
						aria-label="时间限制（分钟）"
					/>
				</div>
			</SimpleGrid>
			<div style={{ marginTop: 12 }}>
				<Text size="xs" c="dimmed" mb={4}>描述</Text>
				<Textarea
					value={description}
					onChange={(e) => set("description", e.currentTarget.value)}
					disabled={disabled}
					placeholder="病例简述…"
					autosize
					minRows={2}
					aria-label="病例描述"
				/>
			</div>
		</Paper>
	);
}
