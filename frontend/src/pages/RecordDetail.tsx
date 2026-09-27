import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Container, Grid, Stack, Text } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getRecordDetail } from "@/api";
import { queryKeys } from "@/api/query-keys";
import { type PracticeKind, startPractice } from "@/api/training";
import { QuestionnaireModal } from "@/components/QuestionnaireModal";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import { useScoringRetry } from "@/hooks/useScoringRetry";
import { useQuestionnaire } from "@/hooks/useQuestionnaire";
import type { SessionDetailFields } from "@/engine/training-record-types";
import { getExistingTrainingRecordId } from "@/utils/error";
import { downloadRecordDetail } from "@/utils/export-record";
import { getScoreDenominator, toScoreData } from "@/utils/score";
import type { MessageData } from "./record-detail/MessagePlayback";
import MessagePlayback from "./record-detail/MessagePlayback";
import PracticeSection from "./record-detail/PracticeSection";
import RecordStatsBar from "./record-detail/RecordStatsBar";
import ReviewFocusSection from "./record-detail/ReviewFocusSection";
import ScoreResultSection from "./record-detail/ScoreResultSection";
import { toPracticeMarker, toPracticeOptions, toReviewFocus } from "./record-detail/record-view";
import { EmotionTrajectory } from "./record-detail/EmotionTrajectory";
import NursingRecordSection from "./record-detail/NursingRecordSection";
import ScoringPendingBanner from "./record-detail/ScoringPendingBanner";

/** 评分未出终态时的自动轮询间隔（GET 记录详情，无自造进度） */
const PENDING_POLL_INTERVAL_MS = 3000;

export default function RecordDetail() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const toast = useToast();
	const { confirm } = useConfirm();
	const { retrying, refreshing, refresh, retry } = useScoringRetry(id);
	const [startingPractice, setStartingPractice] = useState<PracticeKind | null>(null);
	const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
		const isDesktop = typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches;
		return { strengths: isDesktop, weaknesses: isDesktop, missed_content: isDesktop, suggestions: isDesktop };
	});
	// 证据 → 对话气泡联动（工作台核心）：只按服务端解析出的 message id 定位
	const [highlightMsgId, setHighlightMsgId] = useState<number | null>(null);

	const { data: record, isError: recordError } = useQuery({
		queryKey: queryKeys.training.detail(id),
		queryFn: () => getRecordDetail(id!).then((r) => r.data),
		enabled: !!id,
		// 评分 pending/processing 期间自动轮询到终态：等待只有一个数据源（真实 GET），
		// 页面不显示任何自造百分比；到达终态（completed/failed/其它）即停止轮询。
		refetchInterval: (query) => {
			const status = query.state.data?.scoring_status;
			return status === "pending" || status === "processing" ? PENDING_POLL_INTERVAL_MS : false;
		},
	});

	useEffect(() => {
		if (recordError) {
			toast.apiError(recordError, "加载失败");
			navigate(-1);
		}
	}, [recordError, navigate, toast]);

	const {
		checkResponse: postCheckResponse,
		isLoading: postQLoading,
		shouldShow: postQShouldShow,
		check: postQCheck,
		submit: postQSubmit,
		dismiss: postQDismiss,
	} = useQuestionnaire({
		caseId: record?.case_id ?? null,
		recordId: id ? Number(id) : null,
		trigger: "after_scoring",
	});

	useEffect(() => {
		if (record?.scoring_status === "completed") {
			void postQCheck();
		}
	}, [postQCheck, record?.scoring_status]);

	if (!record) return <LoadingSkeleton />;

	const duration = (record as { end_time?: string | null; start_time?: string }).end_time
		? Math.round(
				(new Date((record as { end_time: string }).end_time).getTime() -
					new Date((record as { start_time: string }).start_time).getTime()) /
					60000,
			)
		: null;
	const recordScore = toScoreData(record.score);
	const hasScore = !!recordScore;
	const scoreMax = getScoreDenominator(recordScore);
	const detailScores = recordScore?.detail_scores ?? {};
	const categories = Object.entries(detailScores);
	const hasDetailItems = categories.some(
		([, v]) => !!v && Array.isArray(v.items) && v.items.length > 0,
	);
	// 逐项判定用原始层（0..raw_scale）；展示层只负责维度分母与进度条
	const rawCategories = Object.entries(recordScore?.raw_detail_scores ?? {});
	// 教师复核必须真的到达学生页：状态/复核人/时间/备注/分数全部来自 score 本身
	const isReviewed = recordScore?.review_status === "reviewed";
	const review = recordScore
		? {
				review_status: recordScore.review_status ?? null,
				reviewed_by_name: recordScore.reviewed_by_name ?? null,
				reviewed_at: recordScore.reviewed_at ?? null,
				review_comment: recordScore.review_comment ?? null,
			}
		: null;
	const practiceMarker = toPracticeMarker(record.practice);
	const practiceOptions = toPracticeOptions(record.practice_options);
	const reviewFocus = toReviewFocus(record.review_focus);
	const reviewFocusNote =
		typeof record.review_focus_note === "string" ? record.review_focus_note : "";

	const messages = (record.messages as MessageData[] | undefined) ?? [];
	// 生成类型尚未重生成（本次新增 nursing_record_submitted_at、terminal_reason）：
	// 按会话字段视图读取，待 main 重生成后此处可退回直读。
	const detail = record as typeof record & SessionDetailFields;
	const sheet = detail.nursing_record_sheet as Record<string, string> | null | undefined;
	const nursingSubmittedAt = detail.nursing_record_submitted_at ?? null;
	const terminalReason = detail.terminal_reason ?? null;
	// 系统终止 vs 学生主动完成：来源不同，复盘时的解读完全不同
	const terminalNotice =
		terminalReason === "timeout"
			? "本次训练因超出时限由系统自动结束"
			: terminalReason === "patient_walkout"
				? "本次训练因患者主动中止访谈而结束"
				: null;

	const handleToggleExpand = (key: string) => {
		setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
	};

	const handleExport = async () => {
		try {
			await downloadRecordDetail(id!);
		} catch {
			toast.error("导出失败");
		}
	};

	/** 证据定位：服务端已给出 message id，直接按 id 高亮（不再用原文子串去猜） */
	const handleMessageClick = (messageId: number | string) => {
		const target = messages.find((m) => String(m.id) === String(messageId));
		setHighlightMsgId(target ? target.id : null);
	};

	/** 「重新评分」= POST retry-scoring（会覆盖本次结果），必须先确认 */
	const handleRetryScoring = async () => {
		const ok = await confirm({
			title: "重新评分",
			message: "重新评分会重新运行 AI 评分并覆盖当前结果，确定继续？",
			confirmLabel: "重新评分",
		});
		if (!ok) return;
		await retry();
	};

	const handleStartPractice = async (kind: PracticeKind) => {
		if (!id) return;
		setStartingPractice(kind);
		try {
			const { data } = await startPractice(id, kind);
			navigate(`/training/${data.record_id}`);
		} catch (err: unknown) {
			// 已有进行中训练时服务端回 409 + record_id：直接带去继续，不制造第二个入口
			const conflictId = getExistingTrainingRecordId(err);
			if (conflictId != null) {
				navigate(`/training/${conflictId}`);
				return;
			}
			toast.apiError(err, "发起再练习失败");
		} finally {
			setStartingPractice(null);
		}
	};

	return (
		<>
			<Container size="xl" py="md">
			<PageHeader
				title={[record.user_display_name, record.case_name].filter(Boolean).join(" · ")}
				backTo="/history"
			/>

			<RecordStatsBar
				record={record as { status?: string; start_time?: string; end_time?: string | null; time_limit?: number; messages?: unknown[]; user_display_name?: string; case_name?: string }}
				duration={duration}
				hasScore={hasScore}
				recordScore={recordScore}
				scoreMax={scoreMax}
			/>

			<ScoringPendingBanner
				record={record as { status?: string; scoring_status?: string | null; scoring_error?: string | null }}
				retrying={retrying}
				refreshing={refreshing}
				onRefresh={() => void refresh()}
				onRetry={() => void handleRetryScoring()}
			/>

			{/* 复盘工作台：左对话回放（证据可定位）｜右评分明细/关键选择/再练习 */}
			<Grid mt="md" align="stretch">
				<Grid.Col span={{ base: 12, lg: 7 }}>
					<Box h="100%" style={{ maxHeight: "calc(100vh - 220px)" }}>
						<MessagePlayback messages={messages} highlightId={highlightMsgId} />
					</Box>
				</Grid.Col>
				<Grid.Col span={{ base: 12, lg: 5 }}>
					<Stack gap="md">
						<ReviewFocusSection
							focus={reviewFocus}
							note={reviewFocusNote}
							onMessageClick={handleMessageClick}
						/>
						{recordScore && (
							<ScoreResultSection
								recordScore={recordScore}
								isReviewed={isReviewed}
								review={review}
								scoreReview={recordScore.review ?? null}
								isTeacher={false}
								expanded={expanded}
								onToggleExpand={handleToggleExpand}
								onExport={handleExport}
								onMessageClick={handleMessageClick}
								scoreMax={scoreMax}
								categories={categories}
								hasDetailItems={hasDetailItems}
								rawCategories={rawCategories}
							/>
						)}
						<PracticeSection
							practice={practiceMarker}
							options={practiceOptions}
							starting={startingPractice}
							onStart={(kind) => void handleStartPractice(kind)}
						/>
						{id && <EmotionTrajectory recordId={id} />}
						{sheet && (
							<NursingRecordSection sheet={sheet} submittedAt={nursingSubmittedAt} />
						)}
						{terminalNotice && (
							<Alert variant="light" color="gray" p="xs" icon={<IconInfoCircle size={16} />}>
								<Text size="xs" c="dimmed">{terminalNotice}</Text>
							</Alert>
						)}
					</Stack>
				</Grid.Col>
			</Grid>
			</Container>
			{postQShouldShow && postCheckResponse && (
				<QuestionnaireModal
					open={postQShouldShow}
					key={postCheckResponse.template_id}
					onComplete={() => { void postQCheck(); }}
					onSkip={postQDismiss}
					checkResponse={postCheckResponse}
					loading={postQLoading}
					onSubmit={postQSubmit}
				/>
			)}
		</>
	);
}
