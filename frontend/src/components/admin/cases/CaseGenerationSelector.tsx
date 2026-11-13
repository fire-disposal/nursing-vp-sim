import { Badge, Paper, SegmentedControl, Stack, Text } from "@mantine/core";
import {
	CASE_GENERATIONS,
	generationOf,
	isCaseWorkflowId,
	type CaseWorkflowId,
} from "./case-generations";

export function CaseGenerationSelector({
	workflow,
	onChange,
	readOnly = false,
}: {
	workflow: string | undefined;
	onChange: (workflow: CaseWorkflowId) => void;
	readOnly?: boolean;
}) {
	const current = generationOf(workflow);
	return (
		<Paper withBorder p="md">
			<Stack gap="sm">
				<Text size="sm" fw={600}>病例代际</Text>
				<SegmentedControl
					fullWidth
					aria-label="病例代际"
					value={current.id}
					disabled={readOnly}
					onChange={(value) => {
						if (isCaseWorkflowId(value)) onChange(value);
					}}
					data={CASE_GENERATIONS.map((item) => ({
						value: item.id,
						label: `${item.generation} · ${item.label}`,
						disabled: readOnly || !item.available,
					}))}
				/>
				<Text size="xs" c="dimmed">{current.description}</Text>
				{current.id === "clinical_reasoning" && (
					<Badge variant="light" color="teal" size="sm" style={{ alignSelf: "flex-start" }}>
						六面结构使用教师表单编辑，JSON 仅作高级视图；保存与发布由服务端校验
					</Badge>
				)}
			</Stack>
		</Paper>
	);
}
