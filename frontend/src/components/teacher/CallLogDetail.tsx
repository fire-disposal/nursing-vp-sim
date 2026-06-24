import { useQuery } from "@tanstack/react-query";
import {
	AlertCircle,
	Clock,
	Cpu,
	DollarSign,
	FileText,
	Hash,
	Zap,
} from "lucide-react";
import { getLogDetail } from "@/api/api-client";
import Badge from "@/components/ui/Badge";
import Sheet from "@/components/ui/Sheet";
import { cn } from "@/lib/utils";

interface CallLogDetailProps {
	logId: number | null;
	onClose: () => void;
}

function safeDate(iso: string | null | undefined): string {
	if (!iso) return "\u2014";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleString("zh-CN");
}

function Block({
	label,
	content,
	maxH = "max-h-96",
}: {
	label: string;
	content: string | null | undefined;
	maxH?: string;
}) {
	if (!content) return null;
	return (
		<div className="mb-4">
			<div className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">
				{label}
			</div>
			<pre
				className={cn(
					"overflow-auto rounded-lg bg-muted/60 p-3 text-xs leading-relaxed whitespace-pre-wrap break-all",
					maxH,
				)}
			>
				{content}
			</pre>
		</div>
	);
}

function MetaRow({
	icon: Icon,
	label,
	value,
}: {
	icon: React.ElementType;
	label: string;
	value: string;
}) {
	return (
		<div className="flex items-center gap-2 text-sm py-1.5 border-b border-border/50 last:border-0">
			<Icon size={14} className="text-muted-foreground shrink-0" />
			<span className="text-muted-foreground w-20 shrink-0">{label}</span>
			<span className="font-medium truncate">{value}</span>
		</div>
	);
}

export default function CallLogDetail({ logId, onClose }: CallLogDetailProps) {
	const {
		data: log,
		isLoading,
		isError,
	} = useQuery({
		queryKey: ["logDetail", logId],
		queryFn: () => getLogDetail(logId!).then((r) => r.data),
		enabled: logId !== null,
	});

	return (
		<Sheet open={logId !== null} onClose={onClose} side="right" size="lg">
			<div className="p-5 pt-14">
				{isLoading && (
					<div className="text-center py-10 text-muted-foreground">
						加载中...
					</div>
				)}
				{isError && (
					<div className="text-center py-10 text-destructive">加载失败</div>
				)}
				{!isLoading && !isError && !log && (
					<div className="text-center py-10 text-muted-foreground">
						暂无数据
					</div>
				)}
				{log && (
					<>
						<h2 className="text-lg font-bold mb-4 flex items-center gap-2">
							<FileText size={18} /> 调用详情 #{log.id}
						</h2>

						<div className="rounded-xl border border-border bg-card p-4 mb-4">
							<MetaRow
								icon={Clock}
								label="时间"
								value={safeDate(log.created_at)}
							/>
							<MetaRow icon={Hash} label="用途" value={log.purpose} />
							<MetaRow
								icon={Cpu}
								label="模型"
								value={`${log.provider_name || "\u2014"} / ${log.model || "\u2014"}`}
							/>
							<MetaRow
								icon={Zap}
								label="延迟"
								value={
									log.latency_ms != null ? `${log.latency_ms}ms` : "\u2014"
								}
							/>
							<MetaRow
								icon={Hash}
								label="Token"
								value={
									[
										log.prompt_tokens != null ? `P:${log.prompt_tokens}` : "",
										log.completion_tokens != null
											? `C:${log.completion_tokens}`
											: "",
										log.total_tokens != null ? `T:${log.total_tokens}` : "",
										log.token_estimated ? "(\u4f30)" : "",
									]
										.filter(Boolean)
										.join(" ") || "\u2014"
								}
							/>
							<MetaRow
								icon={DollarSign}
								label="\u8d39\u7528"
								value={
									log.estimated_cost != null
										? `\xA5${Number(log.estimated_cost).toFixed(6)} ${log.cost_currency || ""}`.trim()
										: "\u2014"
								}
							/>
							<div className="flex items-center gap-2 text-sm py-1.5 border-b border-border/50 last:border-0">
								<AlertCircle
									size={14}
									className="text-muted-foreground shrink-0"
								/>
								<span className="text-muted-foreground w-20 shrink-0">
									状态
								</span>
								<Badge
									variant={log.status === "success" ? "success" : "danger"}
								>
									{log.status}
								</Badge>
								{log.error_type && (
									<Badge variant="warning">{log.error_type}</Badge>
								)}
							</div>
							{log.error_message && (
								<div className="mt-2 p-2 rounded bg-danger text-danger-foreground text-xs">
									{log.error_message}
								</div>
							)}
						</div>

						<Block
							label="System Prompt + Messages (\u8bf7\u6c42)"
							content={log.request_text}
						/>
						<Block
							label="LLM Response (\u54cd\u5e94)"
							content={log.response_text}
						/>
					</>
				)}
			</div>
		</Sheet>
	);
}
