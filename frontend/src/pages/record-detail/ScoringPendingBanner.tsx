import { RefreshCw } from "lucide-react";
import { cn } from "@/utils/cn";

interface ScoringPendingRecord {
	status?: string;
	scoring_status?: string | null;
	scoring_error?: string | null;
}

interface Props {
	record: ScoringPendingRecord;
	retrying: boolean;
	retryProgress?: number | null;
	onRetry: () => void;
}

export default function ScoringPendingBanner({
	record,
	retrying,
	retryProgress,
	onRetry,
}: Props) {
	if (record.status !== "completed" || record.scoring_status === "completed") {
		return null;
	}

	return (
		<div className="rounded-xl border border-warning bg-warning p-5 sm:p-6">
			<div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
				<div className="flex-1">
					<h3 className="font-semibold text-warning-foreground">
						{record.scoring_status === "pending" ||
						record.scoring_status === "processing"
							? "评分正在生成中..."
							: "暂无评分"}
					</h3>
					<p className="text-sm text-warning-foreground/80 mt-1">
						{record.scoring_status === "pending" ||
						record.scoring_status === "processing"
							? "AI 正在分析对话内容，预计几秒到一分钟内完成。"
							: record.scoring_status === "failed"
								? `评分失败: ${record.scoring_error || "未知错误"}`
								: "评分尚未生成"}
					</p>
					{retrying && retryProgress != null && (
						<div className="mt-3">
							<div className="flex items-center gap-2">
								<div className="flex-1 h-2 rounded-full bg-amber-200 overflow-hidden">
									<div
										className="h-full rounded-full bg-amber-600 transition-all duration-500"
										style={{ width: `${(retryProgress / 30) * 100}%` }}
									/>
								</div>
								<span className="text-xs text-warning-foreground/70 font-medium tabular-nums shrink-0">
									{retryProgress}/30
								</span>
							</div>
						</div>
					)}
				</div>
				{(record.scoring_status === "failed" ||
					record.scoring_status == null) && (
					<button
						className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
						onClick={onRetry}
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
				{(record.scoring_status === "pending" ||
					record.scoring_status === "processing") && (
					<button
						className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-200 text-amber-800 text-sm font-medium hover:bg-amber-300 transition-colors disabled:opacity-50 shrink-0"
						onClick={onRetry}
						disabled={retrying}
					>
						<RefreshCw
							size={14}
							className={cn(retrying && "animate-spin")}
						/>
						<span>{retrying ? "刷新中..." : "刷新状态"}</span>
					</button>
				)}
			</div>
		</div>
	);
}
