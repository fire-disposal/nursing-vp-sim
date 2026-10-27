import { Alert, Box, Button, Group, Loader, Paper, Progress, Stack, Text, Title } from "@mantine/core";
import { IconInfoCircle, IconRefresh, IconRotateClockwise } from "@tabler/icons-react";

interface ScoreStatusRecord {
	status?: string;
	scoring_status?: string | null;
	scoring_error?: string | null;
}

interface Props {
	record: ScoreStatusRecord;
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
 * 记录「分数状态」的唯一呈现（学生结果页与教师记录页共用）。
 *
 * 三档，动作严格分开、不能合并：
 * - 评分未出终态（pending/processing/未触发）→ 黄色横幅 +「刷新状态」（只读 GET）；
 * - 评分失败（failed）→ 说明原因 +「重新评分」（POST retry-scoring）；
 * - **没走正常评分流程**（discarded/abandoned/failed 训练）→ 灰色说明，无按钮：
 *   这类记录没有可重试的评分，给「重新评分」只会制造必然失败的点击。
 *
 * 进度条为不定态：后端没有给出可靠进度时，前端不编造百分比。
 */
const UNSCORED_NOTICE: Record<string, { title: string; description: string }> = {
	discarded: {
		title: "未生成评分",
		description: "本次训练没有有效问诊内容（未向患者提问），不参与评分，对话记录仍保留在下方。",
	},
	abandoned: {
		title: "本次训练未完成",
		description: "会话长时间没有继续，已自动放弃，未生成评分。需要成绩请重新开始一次训练。",
	},
	failed: {
		title: "本次训练未正常完成",
		description: "未生成评分。如需确认原因，请联系教师查看这条记录。",
	},
};

export default function ScoreStatusBanner({
	record,
	retrying,
	refreshing,
	onRefresh,
	onRetry,
}: Props) {
	if (record.scoring_status === "completed") return null;

	// 没走完正常评分流程：先把「为什么没有分数」说清楚，而不是留一页空白让人猜
	if (record.status !== "completed") {
		const notice = record.status ? UNSCORED_NOTICE[record.status] : undefined;
		if (!notice) return null;
		return (
			<Alert variant="light" color="gray" icon={<IconInfoCircle size={18} />}>
				<Text size="sm" fw={600}>
					{notice.title}
				</Text>
				<Text size="sm" c="dimmed" mt={2}>
					{notice.description}
				</Text>
			</Alert>
		);
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
