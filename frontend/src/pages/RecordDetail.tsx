import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	ArrowLeft,
	BarChart3,
	CheckCircle,
	ChevronRight,
	Clock,
	Download,
	Edit3,
	FileText,
	Lightbulb,
	MessageCircle,
	RefreshCw,
	ShieldCheck,
	ThumbsDown,
	ThumbsUp,
	User,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
	exportRecordDetail,
	getRecordDetail,
	getScoreReview,
	retryScoring,
	submitScoreReview,
} from "@/api/api-client";
import { queryKeys } from "@/api/query-keys";
import { CollapsibleSection, ReviewEditor, ScoreItem } from "@/components/RecordReview";
import { useToast } from "@/components/Toast";
import { ScoreCardInner } from "@/components/training/panels/scoring-display/ScoreCard";
import Badge from "@/components/ui/Badge";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import type { ScoreData as EngineScoreData } from "@/engine/types";
import { cn } from "@/lib/utils";
import useAuthStore from "@/stores/authStore";
import type { DetailScoreCategory, ScoreData } from "@/types/score";

interface MessageData {
	id: number;
	role: string;
	content: string;
}

export default function RecordDetail() {
	const { id } = useParams<{ id: string }>();
	const [showScore, setShowScore] = useState(false);
	const [retrying, setRetrying] = useState(false);
	const [showReviewEditor, setShowReviewEditor] = useState(false);
	const [submittingReview, setSubmittingReview] = useState(false);
	const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
		const isDesktop = typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches;
		return {
			strengths: isDesktop,
			weaknesses: isDesktop,
			missed_content: isDesktop,
			suggestions: isDesktop,
		};
	});
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const toast = useToast();
	const user = useAuthStore((s) => s.user);

	const { data: record, isError: recordError } = useQuery({
		queryKey: queryKeys.training.detail(id!),
		queryFn: () => getRecordDetail(id!).then((r) => r.data),
		enabled: !!id,
	});

	const { data: review } = useQuery({
		queryKey: queryKeys.training.review(id!),
		queryFn: () => getScoreReview(id!).then((r) => r.data),
		enabled: !!id && !!record?.score,
		placeholderData: (prev) => prev,
		staleTime: 2 * 60_000,
	});

	useEffect(() => {
		if (recordError) {
			toast.error("加载记录详情失败");
			navigate("/history");
		}
	}, [recordError, navigate, toast]);

	const isReviewed = review?.review_status === "reviewed";
	const isTeacher = user?.role === "teacher";

	const mountedRef = useRef(true);
	useEffect(() => {
		return () => {
			mountedRef.current = false;
		};
	}, []);

	const handleRetryScoring = async () => {
		setRetrying(true);
		try {
			await retryScoring(id!);
			toast.info("评分已重新触发，请稍后刷新查看结果");
			for (let i = 0; i < 30; i++) {
				if (!mountedRef.current) break;
				await new Promise<void>((r) => setTimeout(r, 3000));
				if (!mountedRef.current) break;
				const { data } = await getRecordDetail(id!);
				if (!mountedRef.current) break;
				if (data.scoring_status === "completed" && data.score) {
					queryClient.setQueryData(queryKeys.training.detail(id!), data);
					toast.success("评分已完成");
					break;
				}
				if (data.scoring_status === "failed") {
					queryClient.setQueryData(queryKeys.training.detail(id!), data);
					toast.error(`评分再次失败: ${data.scoring_error || "未知错误"}`);
					break;
				}
			}
		} catch (err: unknown) {
			toast.apiError(err, "重试评分失败");
		} finally {
			setRetrying(false);
		}
	};

	const handleExport = async () => {
		try {
			const res = await exportRecordDetail(id!);
			const url = URL.createObjectURL(
				new Blob([res.data], { type: "text/plain" }),
			);
			const a = document.createElement("a");
			a.href = url;
			a.download = `record_${id}.txt`;
			a.click();
			URL.revokeObjectURL(url);
		} catch {
			toast.error("导出失败");
		}
	};

	const handleSubmitReview = async (
		modifiedScores: Record<string, DetailScoreCategory>,
		comment: string,
	) => {
		setSubmittingReview(true);
		try {
			await submitScoreReview(id!, {
				detail_scores: modifiedScores,
				comment,
			});
			toast.success("复核已提交");
			setShowReviewEditor(false);
			queryClient.invalidateQueries({
				queryKey: queryKeys.training.detail(id!),
			});
			queryClient.invalidateQueries({ queryKey: queryKeys.training.review(id!) });
		} catch (err: unknown) {
			toast.apiError(err, "提交复核失败");
		} finally {
			setSubmittingReview(false);
		}
	};

	if (!record) {
		return (
			<div className="space-y-6 p-4">
				<div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
					{Array.from({ length: 4 }).map((_, i) => (
						<LoadingSkeleton key={i} variant="stats" />
					))}
				</div>
				<LoadingSkeleton variant="card" />
			</div>
		);
	}

	const duration = record.end_time
		? Math.round(
				(new Date(record.end_time).getTime() -
					new Date(record.start_time).getTime()) /
					60000,
			)
		: null;
	const scoreMax = record.score?.detail_scores
		? Object.values(record.score.detail_scores).reduce((sum: number, value) => {
				if (
					value &&
					typeof value === "object" &&
					"max" in (value as DetailScoreCategory)
				)
					return sum + ((value as DetailScoreCategory).max || 0);
				return sum + 30;
			}, 0)
		: 100;

	const recordScore = record.score as ScoreData | null;
	const messages = (record.messages || []) as MessageData[];
	const hasScore = !!record.score;
	const detailScores = recordScore?.detail_scores || {};
	const categories = Object.entries(detailScores);
	const hasDetailItems = categories.some(
		([, v]) =>
			v &&
			typeof v === "object" &&
			Array.isArray(v.items) &&
			v.items.length > 0,
	);

	return (
		<>
			<div className="max-w-4xl mx-auto space-y-6">
				<nav className="flex items-center gap-2 text-sm">
					<button
						onClick={() => navigate("/history")}
						className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
					>
						<ArrowLeft size={16} />
						<span>训练记录</span>
					</button>
					<ChevronRight size={14} className="text-muted-foreground/50" />
					<span className="font-medium text-foreground">#{record.id}</span>
				</nav>

				<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
					<div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 sm:p-4">
						<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
							<User size={18} />
						</div>
						<div className="min-w-0">
							<div className="text-base font-bold truncate">
								{(record as { user_display_name?: string }).user_display_name ||
									"-"}
							</div>
							<div className="text-xs text-muted-foreground">学生</div>
						</div>
					</div>

					<div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 sm:p-4">
						<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
							<FileText size={18} />
						</div>
						<div className="min-w-0">
							<div className="text-base font-bold truncate">
								{record.case_name || "-"}
							</div>
							<div className="text-xs text-muted-foreground">病例</div>
						</div>
					</div>

					<div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 sm:p-4">
						<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
							<Clock size={18} />
						</div>
						<div className="min-w-0">
							<div className="text-xl font-bold">
								{duration != null ? `${duration}分钟` : "-"}
							</div>
							<div className="text-xs text-muted-foreground">训练时长</div>
						</div>
					</div>

					<div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 sm:p-4">
						<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400">
							<BarChart3 size={18} />
						</div>
						<div className="min-w-0">
							<div className="text-xl font-bold">
								{recordScore?.total_score ?? "-"}
							</div>
							<div className="text-xs text-muted-foreground">
								{hasScore ? `得分 / ${scoreMax}` : "得分"}
							</div>
						</div>
					</div>
				</div>

				{record.status === "completed" && !record.score && (
					<div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-5 sm:p-6">
						<div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
							<div>
								<h3 className="font-semibold text-amber-700 dark:text-amber-400">
									{record.scoring_status === "pending" ||
									record.scoring_status === "processing"
										? "评分正在生成中..."
										: "暂无评分"}
								</h3>
								<p className="text-sm text-amber-700/80 dark:text-amber-400/80 mt-1">
									{record.scoring_status === "pending" ||
									record.scoring_status === "processing"
										? "AI 正在分析对话内容，预计几秒到一分钟内完成。"
										: record.scoring_status === "failed"
											? `评分失败: ${record.scoring_error || "未知错误"}`
											: "评分尚未生成"}
								</p>
							</div>
							{(record.scoring_status === "failed" ||
								record.scoring_status == null) && (
								<button
									className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
									onClick={handleRetryScoring}
									disabled={retrying}
								>
									<RefreshCw
										size={14}
										className={cn(retrying && "animate-spin")}
									/>
									<span>
										{retrying
											? "请求中..."
											: record.scoring_status === "failed"
												? "重新评分"
												: "请求评分"}
									</span>
								</button>
							)}
						</div>
					</div>
				)}

				{hasScore && recordScore && (
					<div className="rounded-xl border border-border bg-card p-5 sm:p-6 space-y-5">
						<div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
							<div className="flex items-center gap-2.5 flex-wrap">
								<h3 className="text-base font-semibold">评分结果</h3>
								{isReviewed ? (
									<Badge variant="success">
										<ShieldCheck size={12} /> 教师已复核
									</Badge>
								) : (
									<Badge variant="info">AI 初评</Badge>
								)}
								{isReviewed && review?.reviewed_by_name && (
									<span className="text-xs text-muted-foreground">
										复核人: {review.reviewed_by_name}
										{review.reviewed_at &&
											` · ${new Date(review.reviewed_at).toLocaleDateString("zh-CN")}`}
									</span>
								)}
							</div>
							<div className="flex flex-wrap gap-2">
								{isTeacher && (
									<button
										className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-sm font-medium hover:bg-muted hover:border-primary/50 transition-colors"
										onClick={() => setShowReviewEditor(true)}
									>
										<Edit3 size={14} /> {isReviewed ? "修改复核" : "复核评分"}
									</button>
								)}
								<button
									className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
									onClick={() => setShowScore(true)}
								>
									查看详细评分
								</button>
								<button
									className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-sm font-medium hover:bg-muted hover:border-primary/50 transition-colors"
									onClick={handleExport}
								>
									<Download size={14} />
									导出记录
								</button>
							</div>
						</div>

						<div className="flex items-baseline gap-2">
							<span className="text-4xl font-extrabold text-primary">
								{recordScore.total_score}
							</span>
							<span className="text-base text-muted-foreground">
								/ {scoreMax} 分
							</span>
						</div>

						{isReviewed && review?.review_comment && (
							<div className="px-4 py-3 rounded-lg bg-muted/50 border border-border text-sm">
								<span className="font-semibold text-muted-foreground">
									复核备注：
								</span>
								<span>{review.review_comment}</span>
							</div>
						)}

						{hasDetailItems && (
							<div className="space-y-4 pt-2 border-t border-border">
								{categories.map(([catName, catData]) => {
									if (
										!catData ||
										!Array.isArray(catData.items) ||
										catData.items.length === 0
									)
										return null;
									const pct =
										catData.max > 0
											? Math.round((catData.score / catData.max) * 100)
											: 0;
									return (
										<div key={catName} className="space-y-2">
											<div className="flex items-center justify-between">
												<span className="text-sm font-semibold">{catName}</span>
												<span className="text-sm text-muted-foreground tabular-nums">
													{catData.score}/{catData.max}
												</span>
											</div>
											<div className="h-2 rounded-full bg-muted overflow-hidden">
												<div
													className={cn(
														"h-full rounded-full transition-all duration-700",
														pct >= 80
															? "bg-green-500"
															: pct >= 50
																? "bg-amber-500"
																: "bg-red-500",
													)}
													style={{ width: `${pct}%` }}
												/>
											</div>
											<div className="space-y-0.5 mt-2">
												{catData.items.map((item, i) => (
													<ScoreItem key={item.id || i} item={item} />
												))}
											</div>
										</div>
									);
								})}
							</div>
						)}

						<CollapsibleSection
							icon={<ThumbsUp size={16} className="text-green-500" />}
							title="表现较好"
							expanded={expanded.strengths}
							onToggle={() =>
								setExpanded((prev) => ({
									...prev,
									strengths: !prev.strengths,
								}))
							}
						>
							{recordScore.strengths && recordScore.strengths.length > 0 ? (
								<ul className="space-y-1.5">
									{recordScore.strengths.map((s, i) => (
										<li
											key={i}
											className="flex items-start gap-2 text-sm text-muted-foreground"
										>
											<CheckCircle
												size={14}
												className="text-green-500 shrink-0 mt-0.5"
											/>
											<span>{s}</span>
										</li>
									))}
								</ul>
							) : (
								<p className="text-sm text-muted-foreground/50 italic">
									AI 未生成此部分内容，可重新评分获取完整报告
								</p>
							)}
						</CollapsibleSection>

						<CollapsibleSection
							icon={<ThumbsDown size={16} className="text-amber-500" />}
							title="需要改善"
							expanded={expanded.weaknesses}
							onToggle={() =>
								setExpanded((prev) => ({
									...prev,
									weaknesses: !prev.weaknesses,
								}))
							}
						>
							{recordScore.weaknesses && recordScore.weaknesses.length > 0 ? (
								<ul className="space-y-1.5">
									{recordScore.weaknesses.map((w, i) => (
										<li
											key={i}
											className="flex items-start gap-2 text-sm text-muted-foreground"
										>
											<span className="size-3.5 rounded-full border-2 border-amber-400 shrink-0 mt-0.5" />
											<span>{w}</span>
										</li>
									))}
								</ul>
							) : (
								<p className="text-sm text-muted-foreground/50 italic">
									AI 未生成此部分内容，可重新评分获取完整报告
								</p>
							)}
						</CollapsibleSection>

						<CollapsibleSection
							icon={<AlertTriangle size={16} className="text-red-500" />}
							title="漏问内容"
							expanded={expanded.missed_content}
							onToggle={() =>
								setExpanded((prev) => ({
									...prev,
									missed_content: !prev.missed_content,
								}))
							}
						>
							{recordScore.missed_content && recordScore.missed_content.length > 0 ? (
								<ul className="space-y-1.5">
									{recordScore.missed_content.map((m, i) => (
										<li
											key={i}
											className="flex items-start gap-2 text-sm text-muted-foreground"
										>
											<X
												size={14}
												className="text-red-400 shrink-0 mt-0.5"
											/>
											<span>{m}</span>
										</li>
									))}
								</ul>
							) : (
								<p className="text-sm text-muted-foreground/50 italic">
									AI 未生成此部分内容，可重新评分获取完整报告
								</p>
							)}
						</CollapsibleSection>

						<CollapsibleSection
							icon={<Lightbulb size={16} className="text-blue-500" />}
							title="改进建议"
							expanded={expanded.suggestions}
							onToggle={() =>
								setExpanded((prev) => ({
									...prev,
									suggestions: !prev.suggestions,
								}))
							}
						>
							{recordScore.suggestions ? (
								<p className="text-sm text-muted-foreground leading-relaxed">
									{recordScore.suggestions}
								</p>
							) : (
								<p className="text-sm text-muted-foreground/50 italic">
									AI 未生成改进建议，可重新评分获取完整报告
								</p>
							)}
						</CollapsibleSection>
					</div>
				)}

				<div className="rounded-xl border border-border bg-card p-5 sm:p-6">
					<h3 className="flex items-center gap-2 text-sm font-semibold mb-4">
						<MessageCircle size={18} />
						对话回放 ({messages.length}条消息)
					</h3>
					<div className="rounded-lg bg-muted/50 p-4 sm:p-6 max-h-[400px] overflow-y-auto space-y-2">
						{messages.map((msg) => (
							<div key={msg.id} className="text-sm leading-relaxed">
								<span
									className={cn(
										"font-semibold mr-2",
										msg.role === "student"
											? "text-primary"
											: "text-teal-600 dark:text-teal-400",
									)}
								>
									{msg.role === "student" ? "学生：" : "患者："}
								</span>
								<span className="text-foreground/80">{msg.content}</span>
							</div>
						))}
					</div>
				</div>
			</div>

			{showScore && record.score && (
				<ScoreCardInner
					score={record.score as EngineScoreData}
					onClose={() => setShowScore(false)}
				/>
			)}

			{showReviewEditor && record.score && (
				<ReviewEditor
					score={record.score as ScoreData}
					review={review ?? null}
					onSubmit={handleSubmitReview}
					onClose={() => setShowReviewEditor(false)}
					submitting={submittingReview}
				/>
			)}
		</>
	);
}
