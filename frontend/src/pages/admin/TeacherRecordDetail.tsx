import { Anchor, Box, Container, Flex, Stack } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconChartBar } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getRecordDetail, submitScoreReview } from "@/api";
import { queryKeys } from "@/api/query-keys";
import { ReviewEditor } from "@/components/record-review";
import { useToast } from "@/components/Toast";
import { useScoringRetry } from "@/hooks/useScoringRetry";
import type { SessionDetailFields } from "@/engine/training-record-types";
import { useConfirm } from "@/components/ui/confirm";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import useAuthStore from "@/stores/authStore";
import type { DetailScoreCategory } from "@/types/score";
import { downloadRecordDetail } from "@/utils/export-record";
import { getScoreDenominator, toScoreData } from "@/utils/score";
import type { MessageData } from "../record-detail/MessagePlayback";
import MessagePlayback from "../record-detail/MessagePlayback";
import NursingRecordSection from "../record-detail/NursingRecordSection";
import RecordStatsBar from "../record-detail/RecordStatsBar";
import ScoreResultSection from "../record-detail/ScoreResultSection";
import ScoringPendingBanner from "../record-detail/ScoringPendingBanner";

export default function TeacherRecordDetail() {
	const { id } = useParams<{ id: string }>();
	const { retrying, retryProgress, retry } = useScoringRetry(id);
	const [showReviewEditor, setShowReviewEditor] = useState(false);
	const [submittingReview, setSubmittingReview] = useState(false);
	// 证据 ↔ 对话气泡联动（工作台，与结果页同款）
	const [highlightMsgId, setHighlightMsgId] = useState<number | null>(null);
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
		const s = toScoreData(record?.score);
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


	const handleRetryScoring = async () => {
		if (hasScoreReview && isReviewed) {
			const ok = await confirm({ title: "重新评分", message: "重新评分将丢弃已有的教师复核，确定继续？" });
			if (!ok) return;
		}
		await retry(hasScoreReview && isReviewed);
	};

	const handleExport = async () => {
		try {
			await downloadRecordDetail(id!);
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
		const recScore = toScoreData(record?.score);
		if (!recScore) return undefined;
		const scReview = recScore.review;
		if (!scReview?.detail_scores || !recScore.detail_scores) return recScore.detail_scores;
		const merged: Record<string, unknown> = { ...recScore.detail_scores };
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
	const recordScore = toScoreData(record.score);
	const scoreMax = getScoreDenominator(recordScore);
	const scoreReview = recordScore?.review ?? null;
	const messages = (record.messages || []) as MessageData[];
	// 生成类型尚未重生成（nursing_record_submitted_at 为本次新增）：按会话字段视图读取
	const detail = record as typeof record & SessionDetailFields;
	const nursingSubmittedAt = detail.nursing_record_submitted_at ?? null;

	const handleToggleExpand = (key: string) => {
		setExpanded((prev) => ({
			...prev,
			[key]: !prev[key],
		}));
	};
	const hasScore = !!recordScore;

	const handleEvidenceClick = (evidence: string) => {
		const probe = evidence.slice(0, 12);
		if (!probe) return;
		const match = messages.find((m) => m.content.includes(probe));
		setHighlightMsgId(match?.id ?? null);
	};
	const detailScores = mergedDetailScores ?? {};
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
					record={record as { user_display_name?: string; case_name?: string }}
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
							<MessagePlayback messages={messages} highlightId={highlightMsgId} />

							{record.nursing_record_sheet && Object.keys(record.nursing_record_sheet).length > 0 && (
								<NursingRecordSection
									title="护理评估记录"
									sheet={record.nursing_record_sheet as Record<string, string>}
									submittedAt={nursingSubmittedAt}
								/>
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
								onEvidenceClick={handleEvidenceClick}
								scoreMax={scoreMax}
								categories={categories}
								hasDetailItems={hasDetailItems}
							/>
						</Box>
					)}
				</Flex>
			</Container>


			{showReviewEditor && recordScore && (
				<ReviewEditor
					score={recordScore}
					review={review ?? null}
					onSubmit={handleSubmitReview}
					onClose={() => setShowReviewEditor(false)}
					submitting={submittingReview}
				/>
			)}
		</>
	);
}
