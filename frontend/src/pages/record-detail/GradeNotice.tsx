import { Badge, Group, Stack, Text, Tooltip } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import type { ScoreGrade } from "@/types/score";

interface Props {
	grade: ScoreGrade | null | undefined;
}

/**
 * 成绩解释（数值分层 + 能力等第可用性）—— 文案与阈值**全部来自服务端政策**
 * （`score.grade` / `grade.policy`），前端不定义阈值、不把数值分层说成能力结论。
 *
 * 历史行没有 `grade` 时整块不渲染：宁可不标注，也不在客户端编一套等第。
 */
export default function GradeNotice({ grade }: Props) {
	if (!grade) return null;

	const policy = grade.policy;
	const bands = policy?.numeric_bands ?? [];
	const tooltip = (
		<Stack gap={4}>
			{policy?.numeric_band_description && <Text size="xs">{policy.numeric_band_description}</Text>}
			{bands.length > 0 && (
				<Text size="xs">
					{bands.map((band) => `${band.label}（≥ ${band.min}）`).join(" · ")}
				</Text>
			)}
			{policy?.capability_note && <Text size="xs">{policy.capability_note}</Text>}
		</Stack>
	);

	return (
		<Group gap={8} wrap="wrap">
			{grade.numeric_band_label && (
				<Badge variant="light" color="gray" size="sm">
					{grade.numeric_band_label}
				</Badge>
			)}
			{grade.capability_label && (
				<Text size="xs" c="dimmed">
					{grade.capability_label}
				</Text>
			)}
			{policy?.capability_note && (
				<Tooltip label={tooltip} multiline w={280} withArrow>
					<Text size="xs" c="dimmed" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
						<IconInfoCircle size={13} /> 等第政策说明
					</Text>
				</Tooltip>
			)}
		</Group>
	);
}
