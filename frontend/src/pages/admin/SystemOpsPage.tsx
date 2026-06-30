import { Activity, AlertTriangle, CheckCircle2, Cpu, RefreshCw, Server, Timer } from "lucide-react";
import { useState } from "react";
import { fetchDiagnose, type DiagnoseResponse } from "@/api/admin/ops";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import StatCard from "@/components/ui/stat-card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { queryKeys } from "@/api/query-keys";
import { useApiQuery } from "@/hooks/useApiQuery";
import { cn } from "@/utils/cn";

function StatGrid({ data }: { data: DiagnoseResponse }) {
	const successRate = data.llm.success_rate;
	const rateColor =
		successRate >= 95 ? "green" : successRate >= 90 ? "amber" : "red";
	const activeSessions = data.metrics?.active_sessions ?? 0;

	return (
		<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
			<StatCard
				icon={Activity}
				value={data.health.status === "ok" ? "正常" : data.health.status}
				label="运行状态"
				color="green"
			/>
			<StatCard
				icon={Cpu}
				value={`${successRate}%`}
				label="LLM 成功率 (24h)"
				color={rateColor}
			/>
			<StatCard
				icon={Timer}
				value={data.scoring.pending}
				label="评分待处理"
				color={data.scoring.pending > 10 ? "amber" : "blue"}
			/>
			<StatCard
				icon={Server}
				value={activeSessions}
				label="活跃会话"
				color="teal"
			/>
		</div>
	);
}

function LLMDetailCard({ data }: { data: DiagnoseResponse }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>LLM 调用 (近 24h)</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="grid grid-cols-2 gap-y-3 text-sm">
					<span className="text-muted-foreground">总调用</span>
					<span className="text-right tabular-nums font-medium">
						{data.llm.total_calls_24h.toLocaleString()}
					</span>
					<span className="text-muted-foreground">成功</span>
					<span className="text-right tabular-nums text-emerald-600">
						{Math.round(data.llm.total_calls_24h * data.llm.success_rate / 100)}
					</span>
					<span className="text-muted-foreground">失败</span>
					<span className="text-right tabular-nums text-danger-foreground">
						{data.llm.error_count_24h}
					</span>
					<span className="text-muted-foreground">平均延迟</span>
					<span className="text-right tabular-nums">
						{data.llm.avg_latency_ms} ms
					</span>
				</div>
				{data.llm.recent_errors.length > 0 && (
					<div className="mt-3 pt-3 border-t">
						<div className="text-xs text-muted-foreground mb-2">Top 错误类型</div>
						<div className="space-y-1">
							{data.llm.recent_errors.map((e) => (
								<div key={e.type} className="flex justify-between text-xs">
									<span className="text-muted-foreground font-mono">
										{e.type || "unknown"}
									</span>
									<span className="tabular-nums">{e.count}</span>
								</div>
							))}
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

function ScoringSessionsCard({ data }: { data: DiagnoseResponse }) {
	const uptimeSeconds = data.metrics?.uptime_seconds ?? 0;
	const uptimeHours = (uptimeSeconds / 3600).toFixed(1);
	const activeSessions = data.metrics?.active_sessions ?? 0;

	return (
		<Card>
			<CardHeader>
				<CardTitle>评分 & 会话</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="grid grid-cols-2 gap-y-3 text-sm">
					<span className="text-muted-foreground">评分待处理</span>
					<span className="text-right tabular-nums font-medium">
						{data.scoring.pending}
					</span>
					<span className="text-muted-foreground">评分进行中</span>
					<span className="text-right tabular-nums font-medium text-blue-600">
						{data.scoring.in_progress}
					</span>
					<span className="text-muted-foreground">卡住 &gt;24h</span>
					<span
						className={cn(
							"text-right tabular-nums font-medium",
							data.scoring.stuck > 0 && "text-danger-foreground",
						)}
					>
						{data.scoring.stuck}
					</span>
					<span className="text-muted-foreground">活跃会话</span>
					<span className="text-right tabular-nums">
						{activeSessions}
					</span>
					<span className="text-muted-foreground">运行时长</span>
					<span className="text-right tabular-nums">
						{uptimeHours} h
					</span>
					<span className="text-muted-foreground">版本</span>
					<span className="text-right font-mono text-xs">
						{data.version}
					</span>
				</div>
			</CardContent>
		</Card>
	);
}

function AlertsCard({ data }: { data: DiagnoseResponse }) {
	const alerts = data.alerts || [];
	return (
		<Card
			className={cn(
				alerts.length > 0
					? "border-amber-500/50 bg-amber-50 dark:bg-amber-950/20"
					: "border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/20",
			)}
		>
			<CardHeader className="flex flex-row items-center gap-2">
				{alerts.length > 0 ? (
					<AlertTriangle className="size-4 text-amber-600" />
				) : (
					<CheckCircle2 className="size-4 text-emerald-600" />
				)}
				<CardTitle>告警</CardTitle>
			</CardHeader>
			<CardContent>
				{alerts.length === 0 ? (
					<p className="text-sm text-emerald-700 dark:text-emerald-400">
						系统运行正常，无告警
					</p>
				) : (
					<ul className="space-y-1">
						{alerts.map((a, i) => (
							<li key={i} className="text-sm text-amber-700 dark:text-amber-400">
								{a}
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}

function ErrorLogTable({ data }: { data: DiagnoseResponse }) {
	const entries = data.errors?.recent || [];
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<CardTitle>最近系统错误</CardTitle>
				<span className="text-xs text-muted-foreground">
					5min: {data.errors.count.last_5min} · 1h: {data.errors.count.last_hour} · 总计: {data.errors.count.total_captured}
				</span>
			</CardHeader>
			<CardContent>
				{entries.length === 0 ? (
					<p className="text-sm text-muted-foreground text-center py-4">暂无错误</p>
				) : (
					<div className="max-h-80 overflow-auto rounded-md border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-36">时间</TableHead>
									<TableHead>来源</TableHead>
									<TableHead>消息</TableHead>
									<TableHead className="w-24">级别</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{entries.map((e, i) => (
									<TableRow key={i}>
										<TableCell className="font-mono text-xs whitespace-nowrap">
											{e.time?.slice(0, 19) ?? "-"}
										</TableCell>
										<TableCell className="font-mono text-xs">
											{e.logger ?? "-"}
										</TableCell>
										<TableCell className="text-xs max-w-[300px] truncate">
											{e.message ?? "-"}
										</TableCell>
										<TableCell className="font-mono text-xs text-muted-foreground">
											{e.level ?? "-"}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

export default function SystemOpsPage() {
	const [autoRefresh, setAutoRefresh] = useState(false);

	const { data, isLoading, refetch } = useApiQuery({
		queryKey: queryKeys.diagnose,
		queryFn: () => fetchDiagnose(),
		staleTime: 15_000,
		refetchInterval: autoRefresh ? 30_000 : false,
	});

	const handleRefresh = () => {
		refetch();
	};

	if (isLoading) return <LoadingSkeleton variant="card" />;
	if (!data) return <p className="text-muted-foreground text-center py-8">诊断数据不可用</p>;

	return (
		<div className="space-y-6 mt-4">
			<PageHeader
				title="系统运维"
				subtitle="LLM 状态 · 评分队列 · 错误日志 · 会话统计"
				actions={
					<div className="flex items-center gap-2">
						<label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none">
							<input
								type="checkbox"
								checked={autoRefresh}
								onChange={(e) => setAutoRefresh(e.target.checked)}
								className="size-3.5"
							/>
							自动刷新
						</label>
						<button
							onClick={handleRefresh}
							className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted transition-colors"
						>
							<RefreshCw className="size-3.5" />
							刷新
						</button>
					</div>
				}
			/>

			<StatGrid data={data} />

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
				<LLMDetailCard data={data} />
				<ScoringSessionsCard data={data} />
			</div>

			<AlertsCard data={data} />

			<ErrorLogTable data={data} />
		</div>
	);
}
