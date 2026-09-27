import { Alert, Stack, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import type { ScoreFallback } from "@/types/score";
import { fallbackKindLabel } from "@/utils/score";

interface Props {
	fallback: ScoreFallback | null | undefined;
}

/**
 * 系统降级横幅 —— `score.fallback` 非空即「这次评分不是正常产出」：
 * 可能是模型返回空/部分、维度被注入默认分、条目未被判定，或本次没有可评条目。
 *
 * 必须显式呈现为系统问题（而不是学生的成绩表现），并列出受影响的条目/维度。
 */
export default function FallbackNotice({ fallback }: Props) {
	if (!fallback) return null;

	const items = Array.isArray(fallback.items) ? fallback.items : [];
	const dims = Array.isArray(fallback.dims) ? fallback.dims : [];

	return (
		<Alert
			variant="light"
			color="red"
			icon={<IconAlertTriangle size={16} />}
			title="评分由系统降级生成，不能当作正常成绩"
			p="sm"
		>
			<Stack gap={4}>
				<Text size="sm">{fallbackKindLabel(fallback)}</Text>
				{dims.length > 0 && (
					<Text size="xs" c="dimmed">
						受影响的维度：{dims.join("、")}
					</Text>
				)}
				{items.length > 0 && (
					<Text size="xs" c="dimmed">
						未判定的条目：{items.join("、")}
					</Text>
				)}
			</Stack>
		</Alert>
	);
}
