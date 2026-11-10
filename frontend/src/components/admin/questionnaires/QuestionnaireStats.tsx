import {
	Badge,
	Button,
	Group,
	Paper,
	Progress,
	ScrollArea,
	SimpleGrid,
	Stack,
	Text,
} from "@mantine/core";
import { IconChartBar, IconClipboardList, IconDownload } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { queryKeys } from "@/api/query-keys";
import { exportQuestionnaireCSV, getQuestionnaireStats } from "@/api/questionnaires";
import type { ResponseStats } from "@/components/admin/questionnaires/types";
import { QUESTION_TYPE_LABELS } from "@/components/admin/questionnaires/types";
import { toast } from "@/components/Toast";
import EmptyState from "@/components/ui/empty-state";
import ErrorState from "@/components/ui/error-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";

interface QuestionnaireStatsProps {
	templateId: number;
}

/**
 * 问卷统计（`/admin/questionnaires/:id/stats`）。
 *
 * 与旧版本的区别：模板不再由父组件的本地 state 传入——页面直接从地址栏的 id 取数，
 * 于是刷新、前进/后退、「返回列表」都落在真实路由上。
 * 失败态显式区分于「0 分配 / 0 完成」：统计取不到时绝不渲染成一张全是 0 的假报表。
 */
export default function QuestionnaireStats({ templateId }: QuestionnaireStatsProps) {
	const navigate = useNavigate();

	const { data: stats, isLoading, isError, error, refetch } = useQuery({
		queryKey: queryKeys.questionnaires.stats(templateId),
		queryFn: () => getQuestionnaireStats(templateId).then((r) => r.data as ResponseStats),
		staleTime: 2 * 60_000,
	});

	const exportCSV = async () => {
		try {
			const response = await exportQuestionnaireCSV(templateId);
			const url = URL.createObjectURL(response.data);
			const a = document.createElement("a");
			a.href = url;
			a.download = `questionnaire_responses_${templateId}.csv`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success("CSV 导出成功");
		} catch (err: unknown) {
			toast.apiError(err, "导出失败");
		}
	};

	return (
		<Paper withBorder shadow="sm" p="md">
			<Group justify="flex-end" mb="md" align="flex-start">
				<Group gap="xs" wrap="wrap">
					<Button
						variant="light"
						leftSection={<IconClipboardList size={14} />}
						onClick={() => navigate(`/admin/questionnaires/${templateId}/responses`)}
					>
						查看答卷
					</Button>
					<Button
						variant="outline"
						leftSection={<IconDownload size={14} />}
						onClick={() => { void exportCSV(); }}
						disabled={isError}
					>
						导出CSV
					</Button>
				</Group>
			</Group>

			{isLoading ? (
				<LoadingSkeleton variant="spinner" message="加载统计数据..." />
			) : isError ? (
				<ErrorState
					title="统计数据加载失败"
					error={error}
					onRetry={() => refetch()}
				/>
			) : stats ? (
				<Stack gap="xl">
					<SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
						<Paper bg="var(--mantine-color-default-hover)" p="md" ta="center">
							<Text size="xl" fw={700} c="blue">
								{stats.total_assigned}
							</Text>
							<Text size="xs" c="dimmed" mt={4}>
								总分配数
							</Text>
						</Paper>
						<Paper bg="var(--mantine-color-default-hover)" p="md" ta="center">
							<Text size="xl" fw={700} c="green">
								{stats.total_completed}
							</Text>
							<Text size="xs" c="dimmed" mt={4}>
								已完成
							</Text>
						</Paper>
						<Paper bg="var(--mantine-color-default-hover)" p="md" ta="center">
							<Text size="xl" fw={700} c="yellow">
								{/* 后端 `completion_rate` 已是百分数（0–100），这里不再乘 100 */}
								{stats.completion_rate.toFixed(1)}%
							</Text>
							<Text size="xs" c="dimmed" mt={4}>
								完成率
							</Text>
						</Paper>
					</SimpleGrid>

					<div>
						<Group gap={6} mb="sm">
							<IconChartBar size={14} />
							<Text size="sm" fw={600}>各题分析</Text>
						</Group>
						{stats.questions.length === 0 ? (
							<EmptyState title="暂无题目数据" />
						) : (
							<Stack gap="md">
								{stats.questions.map((q) => (
									<Paper key={q.question_id} p="md">
										<Group gap={8} mb="sm">
											<Badge variant="light" color="blue">
												{QUESTION_TYPE_LABELS[q.question_type] ||
													q.question_type}
											</Badge>
											<Text size="sm" fw={500}>{q.content}</Text>
										</Group>
										{q.question_type === "likert_5" && q.avg_likert != null && (
											<div>
												<Group gap={8} mb={4}>
													<Text size="xs" c="dimmed">平均分:</Text>
													<Text size="sm" fw={600}>
														{q.avg_likert.toFixed(2)}
													</Text>
												</Group>
												<Progress
													value={(q.avg_likert / 5) * 100}
													size="sm"
													radius="md"
												/>
												<Group justify="space-between" mt={2}>
													{["1", "2", "3", "4", "5"].map((n) => (
														<Text key={n} size="xs" c="dimmed">
															{n}
														</Text>
													))}
												</Group>
											</div>
										)}
										{q.question_type === "multiple_choice" &&
											q.choice_distribution && (
												<Stack gap={6}>
													{Object.entries(q.choice_distribution).map(
														([option, count]) => (
															<Group key={option} gap={8} wrap="nowrap">
																<Text
																	size="xs"
																	c="dimmed"
																	truncate
																	style={{ width: 96 }}
																>
																	{option}
																</Text>
																<Progress
																	value={
																		stats.total_completed > 0
																			? (count / stats.total_completed) * 100
																			: 0
																	}
																	size="xs"
																	radius="md"
																	color="blue"
																	style={{ flex: 1 }}
																/>
																<Text size="xs" fw={500} w={32} ta="right">
																	{count}
																</Text>
															</Group>
														),
													)}
												</Stack>
											)}
										{q.question_type === "short_text" && q.text_answers && (
											<ScrollArea h={160}>
												<Stack gap={4}>
													{q.text_answers.length === 0 ? (
														<Text size="xs" c="dimmed">
															暂无回复
														</Text>
													) : (
														q.text_answers.map((r, i) => (
															<Paper
																key={i}
																bg="var(--mantine-color-default-hover)"
																radius="sm"
																px="xs"
																py={4}
															>
																<Text size="sm" c="dimmed">{r}</Text>
															</Paper>
														))
													)}
												</Stack>
											</ScrollArea>
										)}
									</Paper>
								))}
							</Stack>
						)}
					</div>
				</Stack>
			) : (
				<EmptyState title="暂无统计数据" />
			)}
		</Paper>
	);
}
