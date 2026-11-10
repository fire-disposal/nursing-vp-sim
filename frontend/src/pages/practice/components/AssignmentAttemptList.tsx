/**
 * 学生作业详情 —— 尝试列表（本页专属组件）。
 *
 * 为什么单独拆一个组件：尝试列表是这一页唯一的「多行数据」，它的空态/未知状态
 * 兜底规则跟页面其余部分无关，放在页面文件里会让「一条记录怎么显示」淹没在布局代码中。
 */
import { Badge, Group, Paper, Stack, Table, Text } from "@mantine/core";
import { IconHistory } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import type { StudentAssignmentAttempt } from "@/api/assignments";
import EmptyState from "@/components/ui/empty-state";
import { formatDateTime } from "@/utils/date";

/**
 * 记录状态词表。未知值原样显示、按只读处理 —— 绝不兜底成「进行中」，
 * 那会把学生送进一个可能已经终结的会话（与 History 页同一取舍）。
 */
const RECORD_STATUS_META: Record<string, { label: string; color: string }> = {
	in_progress: { label: "进行中", color: "brand" },
	completed: { label: "已完成", color: "green" },
	abandoned: { label: "已放弃", color: "gray" },
	discarded: { label: "已作废", color: "gray" },
};

export function recordStatusMeta(status: string): { label: string; color: string } {
	return RECORD_STATUS_META[status] ?? { label: status || "未知状态", color: "gray" };
}

/**
 * 评分状态 → 展示文案。``completed`` 且无分 = 服务端尚未算出分数（不是 0 分），
 * 两件事分开说，否则学生以为自己考了 0。
 */
export function scoringLabel(attempt: StudentAssignmentAttempt): string {
	if (attempt.score_total !== null && attempt.score_total !== undefined) {
		return `${attempt.score_total} 分`;
	}
	switch (attempt.scoring_status) {
		case "pending":
			return "待评分";
		case "processing":
			return "评分中";
		case "failed":
			return "评分失败";
		case "completed":
			return "暂无分数";
		default:
			return "—";
	}
}

interface AttemptListProps {
	attempts: StudentAssignmentAttempt[];
	/** 完成后可看复盘的尝试才可点：只有已完成记录有详情页 */
	reviewable: boolean;
}

export default function AssignmentAttemptList({ attempts, reviewable }: AttemptListProps) {
	if (attempts.length === 0) {
		return (
			<EmptyState
				icon={IconHistory}
				title="还没有尝试记录"
				description="开始练习后，每一次尝试都会出现在这里。"
			/>
		);
	}

	return (
		<Stack gap="xs">
			{attempts.map((attempt, index) => {
				const status = recordStatusMeta(attempt.status);
				const canReview = reviewable && attempt.status === "completed";
				return (
					<Paper key={attempt.record_id} withBorder radius="md" p="sm">
						<Group justify="space-between" gap="sm" wrap="wrap">
							<Group gap="xs" wrap="wrap">
								{/* 尝试序号按列表顺序（服务端给的是新→旧），让「第一次/第二次」可读 */}
								<Text size="sm" fw={600}>
									第 {attempts.length - index} 次
								</Text>
								<Badge variant="light" color={status.color} size="sm">
									{status.label}
								</Badge>
								{attempt.is_overdue && (
									<Badge variant="light" color="red" size="sm">
										逾期提交
									</Badge>
								)}
							</Group>
							<Text size="sm" fw={600}>
								{scoringLabel(attempt)}
							</Text>
						</Group>
						<Group gap="md" mt={6} wrap="wrap">
							<Text size="xs" c="dimmed">
								开始 {formatDateTime(attempt.start_time) || "—"}
							</Text>
							<Text size="xs" c="dimmed">
								结束 {formatDateTime(attempt.end_time) || "未结束"}
							</Text>
							{canReview && (
								<Text size="xs">
									<Link to={`/record/${attempt.record_id}`}>查看复盘</Link>
								</Text>
							)}
						</Group>
					</Paper>
				);
			})}
		</Stack>
	);
}

/** 宽屏下的表格形态（同一份数据的另一种排布，不重复业务规则）。 */
export function AssignmentAttemptTable({ attempts, reviewable }: AttemptListProps) {
	if (attempts.length === 0) {
		return <AssignmentAttemptList attempts={attempts} reviewable={reviewable} />;
	}
	return (
		<Table.ScrollContainer minWidth={520}>
			<Table verticalSpacing="xs" highlightOnHover>
				<Table.Thead>
					<Table.Tr>
						<Table.Th>次数</Table.Th>
						<Table.Th>状态</Table.Th>
						<Table.Th>分数</Table.Th>
						<Table.Th>开始</Table.Th>
						<Table.Th>结束</Table.Th>
						<Table.Th>复盘</Table.Th>
					</Table.Tr>
				</Table.Thead>
				<Table.Tbody>
					{attempts.map((attempt, index) => {
						const status = recordStatusMeta(attempt.status);
						const canReview = reviewable && attempt.status === "completed";
						return (
							<Table.Tr key={attempt.record_id}>
								<Table.Td>第 {attempts.length - index} 次</Table.Td>
								<Table.Td>
									<Badge variant="light" color={status.color} size="sm">
										{status.label}
									</Badge>
								</Table.Td>
								<Table.Td>{scoringLabel(attempt)}</Table.Td>
								<Table.Td>{formatDateTime(attempt.start_time) || "—"}</Table.Td>
								<Table.Td>{formatDateTime(attempt.end_time) || "未结束"}</Table.Td>
								<Table.Td>
									{canReview ? <Link to={`/record/${attempt.record_id}`}>查看复盘</Link> : "—"}
								</Table.Td>
							</Table.Tr>
						);
					})}
				</Table.Tbody>
			</Table>
		</Table.ScrollContainer>
	);
}
