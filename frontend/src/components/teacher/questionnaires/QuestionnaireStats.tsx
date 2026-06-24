import { ArrowLeft, BarChart3, Download } from "lucide-react";
import { exportQuestionnaireCSV } from "@/api/questionnaires";
import { toast } from "@/components/Toast";
import type {
	ResponseStats,
	TemplateListItem,
} from "@/components/teacher/questionnaires/types";
import { QUESTION_TYPE_LABELS } from "@/components/teacher/questionnaires/types";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import LoadingState from "@/components/ui/loading-state";

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
		<div className="rounded-xl border border-border bg-card shadow-sm p-6">
			<div className="flex items-center justify-between mb-6">
				<div>
					<button
						type="button"
						onClick={onBack}
						className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2 cursor-pointer"
					>
						<ArrowLeft size={14} />
						返回列表
					</button>
					<h2 className="text-lg font-semibold">{template.title} - 数据统计</h2>
				</div>
				<Button variant="outline" onClick={exportCSV}>
					<Download size={14} /> 导出CSV
				</Button>
			</div>

			{isLoading ? (
				<LoadingState message="加载统计数据..." />
			) : stats ? (
				<div className="space-y-6">
					<div className="grid grid-cols-3 gap-4">
						<div className="rounded-xl border border-border bg-muted p-4 text-center">
							<div className="text-2xl font-bold text-primary">
								{stats.total_assigned}
							</div>
							<div className="text-xs text-muted-foreground mt-1">总分配数</div>
						</div>
						<div className="rounded-xl border border-border bg-muted p-4 text-center">
							<div className="text-2xl font-bold text-success-foreground">
								{stats.total_completed}
							</div>
							<div className="text-xs text-muted-foreground mt-1">已完成</div>
						</div>
						<div className="rounded-xl border border-border bg-muted p-4 text-center">
							<div className="text-2xl font-bold text-warning-foreground">
								{(stats.completion_rate * 100).toFixed(1)}%
							</div>
							<div className="text-xs text-muted-foreground mt-1">完成率</div>
						</div>
					</div>

					<div>
						<h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
							<BarChart3 size={14} />
							各题分析
						</h3>
						{stats.questions.length === 0 ? (
							<EmptyState title="暂无题目数据" />
						) : (
							<div className="space-y-4">
								{stats.questions.map((q) => (
									<div
										key={q.question_id}
										className="border border-border rounded-lg p-4"
									>
										<div className="flex items-center gap-2 mb-3">
											<Badge variant="info">
												{QUESTION_TYPE_LABELS[q.question_type] ||
													q.question_type}
											</Badge>
											<span className="text-sm font-medium">{q.content}</span>
										</div>
										{q.question_type === "likert_5" && q.avg_likert != null && (
											<div>
												<div className="flex items-center gap-2 mb-1">
													<span className="text-xs text-muted-foreground">
														平均分:
													</span>
													<span className="text-sm font-semibold">
														{q.avg_likert.toFixed(2)}
													</span>
												</div>
												<div className="w-full bg-muted rounded-full h-3 overflow-hidden">
													<div
														className="bg-primary h-3 rounded-full transition-all"
														style={{ width: `${(q.avg_likert / 5) * 100}%` }}
													/>
												</div>
												<div className="flex justify-between text-xs text-muted-foreground mt-0.5">
													<span>1</span>
													<span>2</span>
													<span>3</span>
													<span>4</span>
													<span>5</span>
												</div>
											</div>
										)}
										{q.question_type === "multiple_choice" &&
											q.choice_distribution && (
												<div className="space-y-1.5">
													{Object.entries(q.choice_distribution).map(
														([option, count]) => (
															<div
																key={option}
																className="flex items-center gap-2"
															>
																<span className="text-xs text-muted-foreground w-24 truncate">
																	{option}
																</span>
																<div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
																	<div
																		className="bg-blue-500 h-2.5 rounded-full transition-all"
																		style={{
																			width: `${stats.total_completed > 0 ? (count / stats.total_completed) * 100 : 0}%`,
																		}}
																	/>
																</div>
																<span className="text-xs font-medium w-8 text-right">
																	{count}
																</span>
															</div>
														),
													)}
												</div>
											)}
										{q.question_type === "short_text" && q.text_answers && (
											<div className="max-h-40 overflow-y-auto space-y-1">
												{q.text_answers.length === 0 ? (
													<span className="text-xs text-muted-foreground">
														暂无回复
													</span>
												) : (
													q.text_answers.map((r, i) => (
														<div
															key={i}
															className="text-sm bg-muted rounded px-2.5 py-1 text-muted-foreground"
														>
															{r}
														</div>
													))
												)}
											</div>
										)}
									</div>
								))}
							</div>
						)}
					</div>
				</div>
			) : (
				<EmptyState title="暂无统计数据" />
			)}
		</div>
	);
}
