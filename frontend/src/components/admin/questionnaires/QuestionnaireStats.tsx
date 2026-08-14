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
	Title,
} from "@mantine/core";
import { IconArrowLeft, IconChartBar, IconDownload } from "@tabler/icons-react";
import { exportQuestionnaireCSV } from "@/api/questionnaires";
import type {
	ResponseStats,
	TemplateListItem,
} from "@/components/admin/questionnaires/types";
import { QUESTION_TYPE_LABELS } from "@/components/admin/questionnaires/types";
import { toast } from "@/components/Toast";
import EmptyState from "@/components/ui/empty-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";

interface QuestionnaireStatsProps {
	template: TemplateListItem;
	stats: ResponseStats | null;
	isLoading: boolean;
	onBack: () => void;
}

export default function QuestionnaireStats({
	template,
	stats,
	isLoading,
	onBack,
}: QuestionnaireStatsProps) {
	const exportCSV = async () => {
		try {
			const response = await exportQuestionnaireCSV(template.id);
			const url = URL.createObjectURL(response.data);
			const a = document.createElement("a");
			a.href = url;
			a.download = `questionnaire_responses_${template.id}.csv`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success("CSV 导出成功");
		} catch (err: unknown) {
			toast.apiError(err, "导出失败");
		}
	};

	return (
		<Paper withBorder shadow="sm" p="md" radius="md">
			<Group justify="space-between" mb="md">
				<div>
					<Button variant="subtle" color="gray" size="sm" onClick={onBack} mb="xs">
						<IconArrowLeft size={14} />
						返回列表
					</Button>
					<Title order={3}>{template.title} - 数据统计</Title>
				</div>
				<Button variant="outline" onClick={exportCSV}>
					<IconDownload size={14} /> 导出CSV
				</Button>
			</Group>

			{isLoading ? (
				<LoadingSkeleton variant="spinner" message="加载统计数据..." />
			) : stats ? (
				<Stack gap="xl">
					<SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
						<Paper
							withBorder
							bg="var(--mantine-color-gray-1)"
							p="md"
							radius="md"
							ta="center"
						>
							<Text size="xl" fw={700} c="blue">
								{stats.total_assigned}
							</Text>
							<Text size="xs" c="dimmed" mt={4}>
								总分配数
							</Text>
						</Paper>
						<Paper
							withBorder
							bg="var(--mantine-color-gray-1)"
							p="md"
							radius="md"
							ta="center"
						>
							<Text size="xl" fw={700} c="green">
								{stats.total_completed}
							</Text>
							<Text size="xs" c="dimmed" mt={4}>
								已完成
							</Text>
						</Paper>
						<Paper
							withBorder
							bg="var(--mantine-color-gray-1)"
							p="md"
							radius="md"
							ta="center"
						>
							<Text size="xl" fw={700} c="yellow">
								{(stats.completion_rate * 100).toFixed(1)}%
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
									<Paper key={q.question_id} withBorder p="md" radius="md">
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
																bg="var(--mantine-color-gray-1)"
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
