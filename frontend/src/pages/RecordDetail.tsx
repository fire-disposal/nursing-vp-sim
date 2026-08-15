import { useQuery } from "@tanstack/react-query";
import { Box, Container, Grid, Paper, Stack, Text, Title } from "@mantine/core";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getRecordDetail } from "@/api";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import type { MessageData } from "./record-detail/MessagePlayback";
import MessagePlayback from "./record-detail/MessagePlayback";
import RecordStatsBar from "./record-detail/RecordStatsBar";
import ScoreResultSection from "./record-detail/ScoreResultSection";
import ScoringPendingBanner from "./record-detail/ScoringPendingBanner";
import type { DetailScoreCategory, ScoreData } from "@/types/score";

export default function RecordDetail() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const toast = useToast();
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

	if (!record) return <LoadingSkeleton />;

	const duration = (record as { end_time?: string | null; start_time?: string }).end_time
		? Math.round(
				(new Date((record as { end_time: string }).end_time).getTime() -
					new Date((record as { start_time: string }).start_time).getTime()) /
					60000,
			)
		: null;
	const recordScore = record.score as ScoreData | null;
	const hasScore = !!recordScore;
	const scoreMax = recordScore?.detail_scores
		? Object.values(recordScore.detail_scores).reduce((sum, value) => {
				if (value && typeof value === "object" && "max" in (value as DetailScoreCategory))
					return sum + ((value as DetailScoreCategory).max || 0);
				return sum + 30;
			}, 0)
		: 100;
	const detailScores = recordScore?.detail_scores ?? {};
	const categories = Object.entries(detailScores);
	const hasDetailItems = categories.some(
		([, v]) => v && typeof v === "object" && Array.isArray(v.items) && v.items.length > 0,
	);

	const messages = (record.messages as MessageData[] | undefined) ?? [];
	const sheet = (record as { nursing_record_sheet?: Record<string, string> }).nursing_record_sheet;

	const handleToggleExpand = (key: string) => {
		setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
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
		<Container size="xl" py="md">
			<PageHeader
				title={[record.user_display_name, record.case_name].filter(Boolean).join(" · ")}
				backTo="/history"
			/>

			<RecordStatsBar
				record={record as { status?: string; start_time?: string; end_time?: string | null; time_limit?: number; messages?: unknown[]; training_type?: string; user_display_name?: string; case_name?: string }}
				duration={duration}
				hasScore={hasScore}
				recordScore={recordScore}
				scoreMax={scoreMax}
			/>

			<ScoringPendingBanner
				record={record as { status?: string; scoring_status?: string | null; scoring_error?: string | null }}
				retrying={false}
				onRetry={() => {}}
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
								onReviewClick={() => {}}
								onExport={() => {}}
								onDetailedScoreClick={() => {}}
								onEvidenceClick={handleEvidenceClick}
								scoreMax={scoreMax}
								categories={categories as [string, DetailScoreCategory][]}
								hasDetailItems={hasDetailItems}
							/>
						)}
						{sheet && <NursingRecordSection sheet={sheet} />}
					</Stack>
				</Grid.Col>
			</Grid>
		</Container>
	);
}

const FIELD_LABELS: Record<string, string> = {
	subjective: "主观资料 (S)", objective: "客观资料 (O)",
	assessment: "评估 (A)", plan: "计划 (P)", evaluation: "评价 (E)",
};

function NursingRecordSection({ sheet }: { sheet: Record<string, string> }) {
	const fields = Object.entries(FIELD_LABELS).filter(([key]) => sheet[key]);
	if (fields.length === 0) return null;
	return (
		<Paper withBorder radius="md" p={{ base: "md", sm: "lg" }} mt="md">
			<Stack gap="sm">
				<Title order={3} size="md">
					护理记录
				</Title>
				{fields.map(([key, label]) => (
					<Box key={key}>
						<Text size="xs" c="dimmed" mb={4}>
							{label}
						</Text>
						<Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
							{sheet[key]}
						</Text>
					</Box>
				))}
			</Stack>
		</Paper>
	);
}
