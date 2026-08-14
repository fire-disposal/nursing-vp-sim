import { Anchor, Box, Container, Flex, Paper, Stack, Text } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconChartBar } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
	exportRecordDetail,
	getRecordDetail,
	retryScoring,
	submitScoreReview,
} from "@/api";
import { queryKeys } from "@/api/query-keys";
import { QuestionnaireModal } from "@/components/QuestionnaireModal";
import { ReviewEditor } from "@/components/record-review";
import { useToast } from "@/components/Toast";
import { useQuestionnaire } from "@/hooks/useQuestionnaire";
import { useConfirm } from "@/components/ui/confirm";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import useAuthStore from "@/stores/authStore";
import type { DetailScoreCategory, ScoreData } from "@/types/score";
import type { MessageData } from "../record-detail/MessagePlayback";
import MessagePlayback from "../record-detail/MessagePlayback";
import RecordStatsBar from "../record-detail/RecordStatsBar";
import ScoreResultSection from "../record-detail/ScoreResultSection";
import ScoringPendingBanner from "../record-detail/ScoringPendingBanner";

export default function TeacherRecordDetail() {
	const { id } = useParams<{ id: string }>();
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
	const toast = useToast();
	const queryClient = useQueryClient();
	const { confirm } = useConfirm();
	const permissions = useAuthStore((s) => s.permissions);

	const { data: record, isError: recordError } = useQuery({
		queryKey: queryKeys.training.detail(id!),
		queryFn: () => getRecordDetail(id!).then((r) => r.data),
		enabled: !!id,
	});

	// 复核信息随详情响应一次携带（后端已并入 score.review_status/reviewed_by_name 等），
	// 不再串行发 GET /review —— 消除详情页瀑布等待。
	const review = useMemo(() => {
		const s = record?.score as (ScoreData & {
			review_status?: string | null;
			reviewed_by_name?: string | null;
			reviewed_at?: string | null;
			review_comment?: string | null;
		}) | null | undefined;
		if (!s?.review_status) return null;
		return {
			review_status: s.review_status,
			reviewed_by_name: s.reviewed_by_name ?? null,
			reviewed_at: s.reviewed_at ?? null,
			review_comment: s.review_comment ?? null,
		};
	}, [record?.score]);

	useEffect(() => {
		if (recordError) {
			navigate("/admin/records");
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
		if (retrying) return;
		if (hasScoreReview && isReviewed) {
			const ok = await confirm({ title: "重新评分", message: "重新评分将丢弃已有的教师复核，确定继续？" });
			if (!ok) return;
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
			<Stack gap="xl" p="md">
				<LoadingSkeleton variant="stats" />
				<LoadingSkeleton variant="card" />
			</Stack>
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
			<Container size="lg" pt="xs" pb="xl">
				<PageHeader
					title={record ? [record.user_display_name, record.case_name].filter(Boolean).join(" · ") : "训练详情"}
					backTo="/admin/records"
				/>
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

				{/* Split pane on large screens */}
				<Flex direction={{ base: "column", lg: "row" }} gap="md" mt="md" align="flex-start">
					{/* Left: conversation + extras */}
					<Box style={{ flex: 1, minWidth: 0 }}>
						<Stack gap="md">
							<MessagePlayback messages={messages} />

							{record.nursing_record_sheet && Object.keys(record.nursing_record_sheet).length > 0 && (
								<NursingRecordSection sheet={record.nursing_record_sheet as Record<string, string>} />
							)}

							{/* Mobile-only score preview: show "查看评分" link before the full section */}
							{hasScore && recordScore && (
								<Anchor
									href="#score-section"
									hiddenFrom="lg"
									style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}
									fw={500}
								>
									<IconChartBar size={16} />
									查看评分详情 ({recordScore.total_score}/{scoreMax}分)
								</Anchor>
							)}
						</Stack>
					</Box>

					{/* Right: score panel */}
					{hasScore && recordScore && (
						<Box id="score-section" w={{ base: "100%", lg: 420 }} style={{ flexShrink: 0, scrollMarginTop: 16 }}>
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
								onDetailedScoreClick={() => {}}
								scoreMax={scoreMax}
								categories={categories}
								hasDetailItems={hasDetailItems}
							/>
						</Box>
					)}
				</Flex>
			</Container>

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

const FIELD_LABELS: Record<string, string> = {
	subjective: "主观资料 (S)",
	objective: "客观资料 (O)",
	assessment: "评估 (A)",
	plan: "计划 (P)",
	evaluation: "评价 (E)",
};

function NursingRecordSection({ sheet }: { sheet: Record<string, string> }) {
	const fields = Object.entries(FIELD_LABELS).filter(([key]) => sheet[key]);
	if (fields.length === 0) return null;

	return (
		<Paper withBorder radius="md" p="md">
			<Stack gap="sm">
				<Text size="md" fw={600}>护理评估记录</Text>
				<Stack gap="sm">
					{fields.map(([key, label]) => (
						<div key={key}>
							<Text size="xs" fw={500} c="dimmed" mb={4}>{label}</Text>
							<Text size="sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{sheet[key]}</Text>
						</div>
					))}
				</Stack>
			</Stack>
		</Paper>
	);
}
