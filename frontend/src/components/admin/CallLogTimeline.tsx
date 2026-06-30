import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clock, Eye, Hash, Zap } from "lucide-react";
import { useState } from "react";
import { getRecordLogs } from "@/api/api-client";
import { queryKeys } from "@/api/query-keys";
import type { components } from "@/api/api-types.gen";
import CallLogDetail from "@/components/admin/CallLogDetail";
import Badge from "@/components/ui/badge";
import EmptyState from "@/components/ui/empty-state";
import LoadingState from "@/components/ui/loading-state";
import { cn } from "@/utils/cn";

type LLMCallLogItem = components["schemas"]["LLMCallLogItem"];

interface CallLogTimelineProps {
	recordId: number;
	onBack: () => void;
}

function safeTime(iso: string | null | undefined): string {
	if (!iso) return "\u2014";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleTimeString("zh-CN", {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

function statusColor(status: string): string {
	if (status === "success") return "bg-green-500";
	if (status === "timeout") return "bg-yellow-500";
	return "bg-red-500";
}

function costStr(cost: number | null | undefined): string {
	if (cost == null) return "\u2014";
	return `\xA5${Number(cost).toFixed(4)}`;
}

export default function CallLogTimeline({
	recordId,
	onBack,
}: CallLogTimelineProps) {
	const [selectedLogId, setSelectedLogId] = useState<number | null>(null);

	const { data, isLoading } = useQuery({
		queryKey: queryKeys.llmCallLogs.timeline(recordId),
		queryFn: () => getRecordLogs(recordId).then((r) => r.data),
	});

	const logs: LLMCallLogItem[] = data?.items ?? [];

	const totals = logs.reduce(
		(acc, l) => ({
			calls: acc.calls + 1,
			tokens: acc.tokens + (l.total_tokens ?? 0),
			cost: acc.cost + (l.estimated_cost ?? 0),
		}),
		{ calls: 0, tokens: 0, cost: 0 },
	);

	return (
		<div className="rounded-xl border border-border bg-card shadow-sm p-5">
			<div className="flex items-center justify-between mb-4">
				<div className="flex items-center gap-2">
					<button
						onClick={onBack}
						className="p-1 -ml-1 rounded hover:bg-muted transition-colors"
						type="button"
					>
						<ArrowRight
							size={16}
							className="rotate-180 text-muted-foreground"
						/>
					</button>
					<h3 className="text-sm font-semibold text-muted-foreground">
						训练记录 #{recordId} 调用时间线
					</h3>
				</div>
				<div className="flex gap-3 text-xs text-muted-foreground">
					<span>{totals.calls} 次调用</span>
					<span>{totals.tokens} token</span>
					<span>{costStr(totals.cost)}</span>
				</div>
			</div>

			{isLoading && <LoadingState message="加载时间线..." />}
			{!isLoading && logs.length === 0 && (
				<EmptyState icon={Clock} title="暂无调用记录" className="py-8" />
			)}
			{!isLoading && logs.length > 0 && (
				<div className="relative pl-6 before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-border">
					{logs.map((log) => (
						<div key={log.id} className="relative pb-3 last:pb-0">
							<div
								className={cn(
									"absolute left-[-17px] top-1.5 size-[15px] rounded-full border-2 border-background",
									statusColor(log.status),
								)}
							/>

							<div className="flex items-start justify-between gap-2">
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2 flex-wrap">
										<span className="text-xs text-muted-foreground font-mono">
											{safeTime(log.created_at)}
										</span>
										<Badge variant="info" className="text-[0.65rem]">
											{log.purpose}
										</Badge>
										<span className="text-[0.65rem] text-muted-foreground/70">
											{log.model || log.provider_name || "\u2014"}
										</span>
										<Badge
											variant={
												log.status === "success"
													? "success"
													: log.status === "timeout"
														? "warning"
														: "danger"
											}
											className="text-[0.65rem]"
										>
											{log.status}
										</Badge>
									</div>
									<div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground/70">
										<span className="flex items-center gap-1">
											<Zap size={10} />
											{log.latency_ms != null
												? `${log.latency_ms}ms`
												: "\u2014"}
										</span>
										<span className="flex items-center gap-1">
											<Hash size={10} />
											{log.total_tokens ?? "\u2014"}
											{log.token_estimated ? "~" : ""}
										</span>
										<span className="flex items-center gap-1">
											{costStr(log.estimated_cost)}
										</span>
									</div>
								</div>
								<button
									type="button"
									onClick={() => setSelectedLogId(log.id)}
									className="shrink-0 flex items-center gap-0.5 text-xs text-primary hover:underline mt-1"
								>
									<Eye size={12} />
									查看
								</button>
							</div>
						</div>
					))}
				</div>
			)}

			<CallLogDetail
				logId={selectedLogId}
				onClose={() => setSelectedLogId(null)}
			/>
		</div>
	);
}
