import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
	exportRecordDetail,
	getRecordDetail,
	getScoreReview,
	retryScoring,
	submitScoreReview,
} from "@/api";
import { queryKeys } from "@/api/query-keys";
import { QuestionnaireModal } from "@/components/QuestionnaireModal";
import { ReviewEditor } from "@/components/record-review";
import { useToast } from "@/components/Toast";
import { ScoreCardInner } from "@/components/training/panels/scoring-display/ScoreCard";
import { useQuestionnaire } from "@/hooks/useQuestionnaire";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import type { ScoreData as EngineScoreData } from "@/engine/types";
import useAuthStore from "@/stores/authStore";
import type { DetailScoreCategory, ScoreData } from "@/types/score";
import type { MessageData } from "./record-detail/MessagePlayback";
import MessagePlayback from "./record-detail/MessagePlayback";
import RecordStatsBar from "./record-detail/RecordStatsBar";
import ScoreResultSection from "./record-detail/ScoreResultSection";
import ScoringPendingBanner from "./record-detail/ScoringPendingBanner";

export default function RecordDetail() {
	const { id } = useParams<{ id: string }>();
	const [showScore, setShowScore] = useState(false);
	const [retrying, setRetrying] = useState(false);
	const [retryProgress, setRetryProgress] = useState<number | null>(null);
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
	const permissions = useAuthStore((s) => s.permissions);

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
	const hasScoreReview = permissions.includes("score_review");

	const abortRef = useRef<AbortController | null>(null);
	useEffect(() => {
		return () => {
			abortRef.current?.abort();
		};
	}, []);

	const caseId = record?.case_id ?? null;
	const recordIdNum = id ? Number(id) : undefined;

	const {
		checkResponse: postCheckResponse,
		isLoading: postQLoading,
		shouldShow: postQShouldShow,
		check: postQCheck,
		submit: postQSubmit,
		dismiss: postQDismiss,
	} = useQuestionnaire({
		caseId,
		recordId: recordIdNum ?? null,
		trigger: "after_scoring",
	});

	useEffect(() => {
		if (!hasScoreReview && record?.scoring_status === "completed") {
			postQCheck();
		}
	}, [record?.scoring_status, hasScoreReview, postQCheck]);

	const sleep = (ms: number, signal: AbortSignal) =>
		new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, ms);
			signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
		});

	const handleRetryScoring = async () => {
		if (hasScoreReview && isReviewed) {
			if (!window.confirm("重新评分将丢弃已有的教师复核，确定继续？")) {
				return;
			}
		}
		setRetrying(true);
		setRetryProgress(0);
		const controller = new AbortController();
		abortRef.current = controller;
		try {
			await retryScoring(id!, hasScoreReview && isReviewed ? { force: true } : undefined);
			toast.info("评分已重新触发，请稍后刷新查看结果");
			for (let i = 0; i < 30; i++) {
				setRetryProgress(i + 1);
				if (controller.signal.aborted) break;
				await sleep(3000, controller.signal);
				if (controller.signal.aborted) break;
				const { data } = await getRecordDetail(id!);
				if (controller.signal.aborted) break;
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
			if (err instanceof DOMException && err.name === "AbortError") return;
			toast.apiError(err, "重试评分失败");
		} finally {
			setRetrying(false);
			setRetryProgress(null);
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

	const mergedDetailScores = useMemo(() => {
		if (!record?.score) return undefined;
		const recScore = record.score as ScoreData;
		const scReview = recScore?.review;
		if (!scReview?.detail_scores || !recScore?.detail_scores) return recScore?.detail_scores;
		const merged = { ...recScore.detail_scores } as Record<string, unknown>;
		for (const [key, val] of Object.entries(scReview.detail_scores)) {
			const existing = merged[key];
			if (existing && typeof existing === "object") {
				merged[key] = { ...(existing as Record<string, unknown>), ...(val as Record<string, unknown>), _reviewed: true };
			} else {
				merged[key] = { ...(val as Record<string, unknown>), _reviewed: true };
			}
		}
		return merged as Record<string, DetailScoreCategory>;
	}, [record?.score]);

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
	const scoreReview = recordScore?.review ?? null;
	const messages = (record.messages || []) as MessageData[];

	const handleToggleExpand = (key: string) => {
		setExpanded((prev) => ({
			...prev,
			[key]: !prev[key],
		}));
	};
	const hasScore = !!record.score;
	const detailScores = (mergedDetailScores || {}) as Record<string, DetailScoreCategory>;
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
			<div className="max-w-4xl mx-auto space-y-4 pt-2">
				<div className="flex items-center gap-2">
					<button onClick={() => navigate("/history")} className="size-8 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground">
						<ArrowLeft size={16} />
					</button>
					<h1 className="text-sm font-semibold truncate">
						{record ? `${record.user_display_name || ""} · ${record.case_name || ""}` : "训练详情"}
					</h1>
				</div>
				<RecordStatsBar
					record={record as { user_display_name?: string; case_name?: string; training_type?: string }}
					duration={duration}
					hasScore={hasScore}
					recordScore={recordScore}
					scoreMax={scoreMax}
				/>

				<ScoringPendingBanner
					record={record as { status?: string; scoring_status?: string | null; scoring_error?: string | null }}
					retrying={retrying}
					retryProgress={retryProgress}
					onRetry={handleRetryScoring}
				/>

				{hasScore && recordScore && (
					<ScoreResultSection
						recordScore={recordScore}
						isReviewed={isReviewed}
						review={review ?? null}
						scoreReview={scoreReview}
						isTeacher={hasScoreReview}
						expanded={expanded}
						onToggleExpand={handleToggleExpand}
						onReviewClick={() => setShowReviewEditor(true)}
						onExport={handleExport}
						onDetailedScoreClick={() => setShowScore(true)}
						scoreMax={scoreMax}
						categories={categories}
						hasDetailItems={hasDetailItems}
					/>
				)}

				{record.triage_result && Object.keys(record.triage_result).length > 0 && (
					<div className="rounded-xl border border-border bg-card p-5 sm:p-6 space-y-3">
						<h3 className="text-base font-semibold">分诊结果</h3>
						<div className="space-y-2 text-sm">
							<div className="flex justify-between">
								<span className="text-muted-foreground">MEWS 评分</span>
								<span className="font-medium tabular-nums">{String(record.triage_result.mews_score ?? "-")}/14</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">分诊级别</span>
								<span className="font-medium">{String(record.triage_result.category || "未选择")}</span>
							</div>
							<div className="flex justify-between">
								<span className="text-muted-foreground">建议科室</span>
								<span className="font-medium">{String(record.triage_result.department || "未选择")}</span>
							</div>
						</div>
					</div>
				)}

				<MessagePlayback messages={messages} />
			</div>

			{postQShouldShow && postCheckResponse && (
				<QuestionnaireModal
					open={postQShouldShow}
					onComplete={() => { postQCheck(); }}
					onSkip={postQDismiss}
					checkResponse={postCheckResponse}
					loading={postQLoading}
					onSubmit={postQSubmit}
				/>
			)}

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
