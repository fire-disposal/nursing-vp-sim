import { Paper, Stack, Text } from "@mantine/core";
import { StringListEditor } from "./StringListEditor";

interface Props {
	hiddenInfo: string[];
	requiredInquiries: string[];
	onHiddenInfoChange: (v: string[]) => void;
	onRequiredInquiriesChange: (v: string[]) => void;
	disabled?: boolean;
}

export function AiFieldsSection({ hiddenInfo, requiredInquiries, onHiddenInfoChange, onRequiredInquiriesChange, disabled }: Props) {
	return (
		<Paper withBorder p="md">
			<Text size="sm" fw={600} mb="xs">AI 辅助字段</Text>
			<Text size="xs" c="dimmed" mb="md">这些字段可由 AI 生成，也可手动编辑</Text>
			<Stack gap="md">
				<div>
					<Text size="xs" fw={600} c="dimmed" mb={4}>隐藏信息</Text>
					<Text size="xs" c="dimmed" opacity={0.6} mb={4}>患者不会主动透露的信息（吸烟史、职业等）</Text>
					<StringListEditor value={hiddenInfo} onChange={onHiddenInfoChange} placeholder="输入后回车添加" disabled={disabled} inputAriaLabel="隐藏信息条目" addAriaLabel="添加隐藏信息" removeAriaLabel="移除隐藏信息" />
				</div>
				<div>
					<Text size="xs" fw={600} c="dimmed" mb={4}>必询要点</Text>
					<Text size="xs" c="dimmed" opacity={0.6} mb={4}>学生必须覆盖的问诊条目</Text>
					<StringListEditor value={requiredInquiries} onChange={onRequiredInquiriesChange} placeholder="输入后回车添加" disabled={disabled} inputAriaLabel="必询要点条目" addAriaLabel="添加必询要点" removeAriaLabel="移除必询要点" />
				</div>
			</Stack>
		</Paper>
	);
}
