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

export default function RecordDetail() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const toast = useToast();
	const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
		const isDesktop = typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches;
		return { strengths: isDesktop, weaknesses: isDesktop, missed_content: isDesktop, suggestions: isDesktop };
	});

	const { data: record, isError: recordError } = useQuery({
		queryKey: queryKeys.training.detail(id!),
		queryFn: () => getRecordDetail(id!).then((r) => r.data),
		enabled: !!id,
	});

	useEffect(() => {
		if (recordError) {
			toast.error("加载记录详情失败");
			navigate("/history");
		}
	}, [recordError, navigate, toast]);

	if (!record) return <LoadingSkeleton />;

	const messages = (record.messages as MessageData[] | undefined) ?? [];
	const score = record.score as { total_score?: number; detail_scores?: Record<string, { score: number; comment?: string }>; feedback?: Record<string, string> } | null | undefined;
	const sheet = (record as { nursing_record_sheet?: Record<string, string> }).nursing_record_sheet;

	return (
		<div className="max-w-6xl mx-auto pt-2 pb-8">
			<div className="flex items-center gap-2 mb-3">
				<button onClick={() => navigate("/history")} className="size-11 rounded-lg border border-border bg-card text-muted-foreground flex items-center justify-center shrink-0 hover:bg-muted hover:text-foreground transition-colors">
					<ArrowLeft size={16} />
				</button>
				<h1 className="text-sm font-semibold truncate">{record.user_display_name || ""} · {record.case_name || ""}</h1>
			</div>

			<RecordStatsBar
				record={record as { status?: string; start_time?: string; end_time?: string | null; time_limit?: number; messages?: unknown[]; training_type?: string }}
				duration={null}
				hasScore={!!score}
				recordScore={null}
				scoreMax={100}
			/>
			{record.scoring_status === "pending" || record.scoring_status === "processing" ? (
				<div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground mt-4">评分进行中，请稍后刷新</div>
			) : record.scoring_status === "failed" ? (
				<div className="rounded-xl border border-red-500/30 bg-red-50/50 dark:bg-red-950/30 p-4 text-center text-sm text-red-700 dark:text-red-400 mt-4">评分失败</div>
			) : null}

			{score && score.total_score != null && (
				<div className="rounded-xl border border-border bg-card p-5 mt-4">
					<h3 className="text-base font-semibold mb-3">评分结果</h3>
					<div className="text-3xl font-bold text-primary">{score.total_score} 分</div>
				</div>
			)}

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
			<h3 className="text-base font-semibold">护理评估记录</h3>
			<div className="space-y-3">
				{fields.map(([key, label]) => (
					<div key={key}>
						<div className="text-xs font-medium text-muted-foreground mb-1">{label}</div>
						<pre className="text-sm whitespace-pre-wrap font-sans">{sheet[key]}</pre>
					</div>
				))}
			</div>
		</div>
	);
}
