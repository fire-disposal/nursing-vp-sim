import { Box, Button, Group, Loader, Paper, Progress, Text, Title } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";

interface ScoringPendingRecord {
	status?: string;
	scoring_status?: string | null;
	scoring_error?: string | null;
}

interface Props {
	record: ScoringPendingRecord;
	retrying: boolean;
	retryProgress?: number | null;
	onRetry: () => void;
}

export default function ScoringPendingBanner({
	record,
	retrying,
	retryProgress,
	onRetry,
}: Props) {
	if (record.status !== "completed" || record.scoring_status === "completed") {
		return null;
	}

	const isGenerating =
		record.scoring_status === "pending" || record.scoring_status === "processing";
	const isFailed = record.scoring_status === "failed";

	const title = isGenerating ? "评分正在生成中..." : "暂无评分";
	const description = isGenerating
		? "AI 正在分析对话内容，预计几秒到一分钟内完成。"
		: isFailed
			? `评分失败: ${record.scoring_error || "未知错误"}`
			: "评分尚未生成";

	return (
		<Paper
			withBorder
			radius="md"
			bg="yellow.0"
			p={{ base: "md", sm: "lg" }}
			style={{ borderColor: "var(--mantine-color-yellow-4)" }}
		>
			<Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
				<Box style={{ flex: 1, minWidth: 240 }}>
					<Title order={3} size="sm" c="yellow.9">
						{title}
					</Title>
					<Text size="sm" c="yellow.7" mt={4}>
						{description}
					</Text>
					{retrying && retryProgress != null && (
						<Group mt="sm" gap="xs">
							<Box style={{ flex: 1 }}>
								<Progress value={(retryProgress / 30) * 100} color="yellow" size="sm" />
							</Box>
							<Text size="xs" c="yellow.7" fw={500} style={{ fontVariantNumeric: "tabular-nums" }}>
								{retryProgress}/30
							</Text>
						</Group>
					)}
				</Box>
				{(isFailed || record.scoring_status == null) && (
					<Button color="yellow" onClick={onRetry} disabled={retrying}>
						{retrying ? <Loader size="sm" color="white" /> : <IconRefresh size={14} />}
						{retrying ? "请求中..." : isFailed ? "重新评分" : "请求评分"}
					</Button>
				)}
				{isGenerating && (
					<Button variant="light" color="yellow" onClick={onRetry} disabled={retrying}>
						{retrying ? <Loader size="sm" /> : <IconRefresh size={14} />}
						{retrying ? "刷新中..." : "刷新状态"}
					</Button>
				)}
			</Group>
		</Paper>
	);
}
