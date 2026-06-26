import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	ChevronRight,
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
import { ReviewEditor } from "@/components/record-review";
import { useToast } from "@/components/Toast";
import { ScoreCardInner } from "@/components/training/panels/scoring-display/ScoreCard";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import type { ScoreData as EngineScoreData } from "@/engine/types";
import useAuthStore from "@/stores/authStore";
import type { DetailScoreCategory, ScoreData } from "@/types/score";
import RecordStatsBar from "./record-detail/RecordStatsBar";
import ScoringPendingBanner from "./record-detail/ScoringPendingBanner";
import ScoreResultSection from "./record-detail/ScoreResultSection";
import MessagePlayback from "./record-detail/MessagePlayback";
import type { MessageData } from "./record-detail/MessagePlayback";

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

	const handleToggleExpand = (key: string) => {
		setExpanded((prev) => ({
			...prev,
			[key]: !prev[key],
		}));
	};
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

				<RecordStatsBar
					record={record as { user_display_name?: string; case_name?: string }}
					duration={duration}
					hasScore={hasScore}
					recordScore={recordScore}
					scoreMax={scoreMax}
				/>

				<ScoringPendingBanner
					record={record as { status?: string; scoring_status?: string | null; scoring_error?: string | null }}
					retrying={retrying}
					onRetry={handleRetryScoring}
				/>

				{hasScore && recordScore && (
					<ScoreResultSection
						recordScore={recordScore}
						isReviewed={isReviewed}
						review={review ?? null}
						isTeacher={isTeacher}
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

				<MessagePlayback messages={messages} />
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
