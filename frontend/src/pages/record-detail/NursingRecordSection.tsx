import { Badge, Box, Group, Paper, Stack, Text } from "@mantine/core";
import { IconLock, IconLockOpen } from "@tabler/icons-react";
import { formatShortDateTime } from "@/utils/date";

const FIELD_LABELS: Record<string, string> = {
	subjective: "主观资料 (S)",
	objective: "客观资料 (O)",
	assessment: "评估 (A)",
	plan: "计划 (P)",
	evaluation: "评价 (E)",
};

interface NursingRecordSectionProps {
	sheet: Record<string, string>;
	/** 提交时间戳；空 = 草稿（内容未冻结，不进入评分证据） */
	submittedAt?: string | null;
	title?: string;
}

/**
 * 护理评估记录回放卡（学生复盘页 / 教师复核页共用）。
 *
 * 提交状态必须显式呈现：教师需要一眼区分「已提交（该版本参与评分）」与
 * 「草稿未提交（未参与评分）」，否则未提交内容会被误读为评分依据。
 */
export default function NursingRecordSection({
	sheet,
	submittedAt,
	title = "护理记录",
}: NursingRecordSectionProps) {
	const fields = Object.entries(FIELD_LABELS).filter(([key]) => sheet[key]);
	if (fields.length === 0) return null;
	const submitted = !!submittedAt;

	return (
		<Paper withBorder p={{ base: "md", sm: "lg" }}>
			<Stack gap="sm">
				<Group justify="space-between" gap="xs" wrap="wrap">
					<Text size="md" fw={600}>
						{title}
					</Text>
					<Badge
						size="sm"
						variant="light"
						color={submitted ? "green" : "orange"}
						leftSection={submitted ? <IconLock size={12} /> : <IconLockOpen size={12} />}
					>
						{submitted
							? `已提交 ${formatShortDateTime(submittedAt)}`
							: "草稿（未提交，不参与评分）"}
					</Badge>
				</Group>
				{fields.map(([key, label]) => (
					<Box key={key}>
						<Text size="xs" fw={500} c="dimmed" mb={4}>
							{label}
						</Text>
						<Text size="sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
							{sheet[key]}
						</Text>
					</Box>
				))}
			</Stack>
		</Paper>
	);
}
