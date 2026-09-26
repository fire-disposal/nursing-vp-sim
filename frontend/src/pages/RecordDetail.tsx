import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Container, Grid, Stack, Text } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getRecordDetail } from "@/api";
import { queryKeys } from "@/api/query-keys";
import { QuestionnaireModal } from "@/components/QuestionnaireModal";
import { useToast } from "@/components/Toast";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import { useScoringRetry } from "@/hooks/useScoringRetry";
import { useQuestionnaire } from "@/hooks/useQuestionnaire";
import type { SessionDetailFields } from "@/engine/training-record-types";
import { downloadRecordDetail } from "@/utils/export-record";
import { getScoreDenominator, toScoreData } from "@/utils/score";
import type { MessageData } from "./record-detail/MessagePlayback";
import MessagePlayback from "./record-detail/MessagePlayback";
import RecordStatsBar from "./record-detail/RecordStatsBar";
import ScoreResultSection from "./record-detail/ScoreResultSection";
import { EmotionTrajectory } from "./record-detail/EmotionTrajectory";
import NursingRecordSection from "./record-detail/NursingRecordSection";
import ScoringPendingBanner from "./record-detail/ScoringPendingBanner";

export default function RecordDetail() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const toast = useToast();
	const { retrying, retryProgress, retry } = useScoringRetry(id);
	const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
		const isDesktop = typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches;
		return { strengths: isDesktop, weaknesses: isDesktop, missed_content: isDesktop, suggestions: isDesktop };
	});
	// 证据 → 对话气泡联动（工作台核心）
	const [highlightMsgId, setHighlightMsgId] = useState<number | null>(null);

	const { data: record, isError: recordError } = useQuery({
		queryKey: queryKeys.training.detail(id),
		queryFn: () => getRecordDetail(id!).then((r) => r.data),
		enabled: !!id,
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
		([, v]) => v && typeof v === "object" && Array.isArray(v.items) && v.items.length > 0,
	);

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

	const handleEvidenceClick = (evidence: string) => {
		const probe = evidence.slice(0, 12);
		if (!probe) return;
		const match = messages.find(
			(m) => m.content.includes(probe) || evidence.slice(0, 6).length > 0 && m.content.includes(evidence.slice(0, 6)),
		);
		setHighlightMsgId(match?.id ?? null);
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
				retryProgress={retryProgress}
				onRetry={() => void retry()}
			/>

			{/* 复盘工作台：左对话回放（证据可定位）｜右评分明细/护理记录 */}
			<Grid mt="md" align="stretch">
				<Grid.Col span={{ base: 12, lg: 7 }}>
					<Box h="100%" style={{ maxHeight: "calc(100vh - 220px)" }}>
						<MessagePlayback messages={messages} highlightId={highlightMsgId} />
					</Box>
				</Grid.Col>
				<Grid.Col span={{ base: 12, lg: 5 }}>
					<Stack gap="md">
						{recordScore && (
							<ScoreResultSection
								recordScore={recordScore}
								isReviewed={false}
								review={null}
								scoreReview={null}
								isTeacher={false}
								expanded={expanded}
								onToggleExpand={handleToggleExpand}
								onExport={handleExport}
								onEvidenceClick={handleEvidenceClick}
								scoreMax={scoreMax}
								categories={categories}
								hasDetailItems={hasDetailItems}
							/>
						)}
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
