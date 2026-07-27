import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getRecordDetail } from "@/api";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
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

	const { data: record, isError: recordError } = useQuery({
		queryKey: queryKeys.training.record(Number(id)),
		queryFn: () => getRecordDetail(Number(id)).then((r) => r.data),
		enabled: !!id,
	});

	useEffect(() => {
		if (recordError) {
			toast.apiError(recordError, "加载失败");
			navigate("/history");
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

	return (
		<div className="max-w-6xl mx-auto pt-2 pb-8">
			<div className="flex items-center gap-2 mb-3">
				<button onClick={() => navigate("/history")} className="size-11 rounded-lg border border-border bg-card text-muted-foreground flex items-center justify-center shrink-0 hover:bg-muted hover:text-foreground transition-colors">
					<ArrowLeft size={16} />
				</button>
				<h1 className="text-sm font-semibold truncate">{(record as { user_display_name?: string }).user_display_name || ""} · {(record as { case_name?: string }).case_name || ""}</h1>
			</div>

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

			{recordScore && (
				<div className="mt-4">
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
						scoreMax={scoreMax}
						categories={categories as [string, DetailScoreCategory][]}
						hasDetailItems={hasDetailItems}
					/>
				</div>
			)}

			{sheet && <NursingRecordSection sheet={sheet} />}

			<div className="mt-4">
				<MessagePlayback messages={messages} />
			</div>
		</div>
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
		<div className="rounded-xl border border-border bg-card p-5 sm:p-6 space-y-3 mt-4">
			<h3 className="text-base font-semibold">护理记录</h3>
			{fields.map(([key, label]) => (
				<div key={key}>
					<div className="text-xs text-muted-foreground mb-1">{label}</div>
					<div className="text-sm whitespace-pre-wrap">{sheet[key]}</div>
				</div>
			))}
		</div>
	);
}
