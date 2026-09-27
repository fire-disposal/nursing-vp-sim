import { Box, Button, Group, Loader, Paper, Progress, Stack, Text, Title } from "@mantine/core";
import { IconRefresh, IconRotateClockwise } from "@tabler/icons-react";

interface ScoringPendingRecord {
	status?: string;
	scoring_status?: string | null;
	scoring_error?: string | null;
}

interface Props {
	record: ScoringPendingRecord;
	/** 「重新评分」（POST retry-scoring）在途 */
	retrying?: boolean;
	/** 「刷新状态」（GET 记录详情）在途 */
	refreshing?: boolean;
	/** GET only：重新拉取记录详情，不触发评分 */
	onRefresh?: () => void;
	/** POST retry-scoring：只在评分失败时提供 */
	onRetry?: () => void;
}

/**
 * 评分进行中 / 失败横幅。
 *
 * 两个动作严格分开，语义不同不能合并：
 * - 「刷新状态」= 只读 GET（页面本身在 pending/processing 期间也会自动轮询到终态）；
 * - 「重新评分」= POST retry-scoring，**仅在 `scoring_status === 'failed'` 时**提供。
 *
 * 进度条为不定态：后端没有给出可靠进度时，前端不编造百分比（旧的 retryProgress/30 已删除）。
 */
export default function ScoringPendingBanner({
	record,
	retrying,
	refreshing,
	onRefresh,
	onRetry,
}: Props) {
	if (record.status !== "completed" || record.scoring_status === "completed") {
		return null;
	}

	const isGenerating =
		record.scoring_status === "pending" || record.scoring_status === "processing";
	const isFailed = record.scoring_status === "failed";

	const title = isGenerating ? "评分正在生成中..." : isFailed ? "评分失败" : "暂无评分";
	const description = isGenerating
		? "AI 正在分析对话内容，本页会自动刷新，完成后直接显示结果。"
		: isFailed
			? `评分失败：${record.scoring_error || "未知错误"}。可重新触发评分。`
			: "评分尚未生成，刷新状态可查看是否有更新。";

	return (
		<Paper withBorder bg="var(--mantine-color-yellow-light)" p={{ base: "md", sm: "lg" }} style={{ borderColor: "var(--mantine-color-yellow-outline)" }} >
			<Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
				<Box style={{ flex: 1, minWidth: 240 }}>
					<Title order={3} size="sm" c="var(--mantine-color-yellow-light-color)">
						{title}
					</Title>
					<Text size="sm" c="var(--mantine-color-yellow-light-color)" mt={4}>
						{description}
					</Text>
					{/* 不定态进度：只表示"正在进行"，不表示完成了百分之多少 */}
					{isGenerating && (
						<Stack gap={4} mt="sm">
							<Progress.Root size="sm" aria-label="评分进行中，进度未知">
								<Progress.Section value={100} animated striped color="yellow" />
							</Progress.Root>
							<Text size="xs" c="var(--mantine-color-yellow-light-color)">
								进度由后台异步任务决定，无法预估剩余时间
							</Text>
						</Stack>
					)}
				</Box>
				<Group gap="xs">
					{onRefresh && (
						<Button
							variant={isFailed ? "light" : "filled"}
							color="yellow"
							onClick={onRefresh}
							disabled={refreshing || retrying}
						>
							{refreshing ? <Loader size="sm" color="white" /> : <IconRefresh size={14} />}
							{refreshing ? "刷新中..." : "刷新状态"}
						</Button>
					)}
					{isFailed && onRetry && (
						<Button color="yellow" onClick={onRetry} disabled={retrying || refreshing}>
							{retrying ? <Loader size="sm" color="white" /> : <IconRotateClockwise size={14} />}
							{retrying ? "请求中..." : "重新评分"}
						</Button>
					)}
				</Group>
			</Group>
		</Paper>
	);
}
