import { Activity, AlertTriangle, CheckCircle2, Cpu, RefreshCw, Server, Timer } from "lucide-react";
import { useState } from "react";
import { fetchOpsDashboard, fetchOpsErrors, type OpsDashboard, type OpsErrors } from "@/api/admin/ops";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useApiQuery } from "@/hooks/useApiQuery";
import { cn } from "@/lib/utils";

function StatGrid({ data }: { data: OpsDashboard }) {
	const successRate = data.llm.success_rate;
	const rateColor =
		successRate >= 95 ? "green" : successRate >= 90 ? "amber" : "red";

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
				value={data.sessions.active}
				label="活跃会话"
				color="teal"
			/>
		</div>
	);
}

function LLMDetailCard({ data }: { data: OpsDashboard }) {
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
					<span className="text-right tabular-nums text-red-500">
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
								<div
									key={e.type}
									className="flex justify-between text-xs"
								>
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

function ScoringSessionsCard({ data }: { data: OpsDashboard }) {
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
					<span className="text-muted-foreground">卡住 &gt;24h</span>
					<span
						className={cn(
							"text-right tabular-nums font-medium",
							data.scoring.stuck > 0 && "text-red-500",
						)}
					>
						{data.scoring.stuck}
					</span>
					<span className="text-muted-foreground">活跃会话</span>
					<span className="text-right tabular-nums">
						{data.sessions.active}
					</span>
					<span className="text-muted-foreground">未读通知</span>
					<span className="text-right tabular-nums">
						{data.notifications.unread}
					</span>
					<span className="text-muted-foreground">运行时长</span>
					<span className="text-right tabular-nums">
						{data.uptime_hours.toFixed(1)} h
					</span>
					<span className="text-muted-foreground">版本</span>
					<span className="text-right font-mono text-xs">
						{data.health.version}
					</span>
				</div>
			</CardContent>
		</Card>
	);
}

function AlertsCard({ alerts }: { alerts: string[] }) {
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

function ErrorLogTable({ data }: { data: OpsErrors }) {
	const entries = data.recent || [];
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<CardTitle>最近系统错误</CardTitle>
				<span className="text-xs text-muted-foreground">
					5min: {data.count.last_5min} · 1h: {data.count.last_hour} · 总计: {data.count.total_captured}
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
									<TableHead className="w-36">位置</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{entries.map((e, i) => (
									<TableRow key={i}>
										<TableCell className="font-mono text-xs whitespace-nowrap">
											{e.timestamp?.slice(0, 19) ?? "-"}
										</TableCell>
										<TableCell className="font-mono text-xs">
											{e.logger ?? "-"}
										</TableCell>
										<TableCell className="text-xs max-w-[300px] truncate">
											{e.message ?? "-"}
										</TableCell>
										<TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
											{e.pathname}:{e.lineno}
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

	const { data: dashboard, isLoading: dashLoading, refetch: refetchDash } = useApiQuery({
		queryKey: ["admin", "ops", "dashboard"],
		queryFn: () => fetchOpsDashboard(),
		staleTime: 15_000,
		refetchInterval: autoRefresh ? 30_000 : false,
	});

	const { data: errors, isLoading: errorsLoading } = useApiQuery({
		queryKey: ["admin", "ops", "errors"],
		queryFn: () => fetchOpsErrors(20),
		staleTime: 15_000,
		refetchInterval: autoRefresh ? 30_000 : false,
	});

	const isLoading = dashLoading || errorsLoading;

	const handleRefresh = () => {
		refetchDash();
	};

	if (isLoading) return <LoadingSkeleton variant="card" />;

	const alerts: string[] = [];

	if (dashboard) {
		if (dashboard.llm.success_rate < 90) {
			alerts.push(`LLM 成功率 ${dashboard.llm.success_rate}% 低于 90%`);
		}
		if (dashboard.llm.error_count_24h > 50) {
			alerts.push(`近 24h LLM 错误 ${dashboard.llm.error_count_24h} 次`);
		}
		if (dashboard.scoring.stuck > 5) {
			alerts.push(`卡住评分 ${dashboard.scoring.stuck} 条`);
		}
		if (dashboard.sessions.active > 50) {
			alerts.push(`活跃会话 ${dashboard.sessions.active} 个`);
		}
	}

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

			{dashboard && <StatGrid data={dashboard} />}

			{dashboard && (
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
					<LLMDetailCard data={dashboard} />
					<ScoringSessionsCard data={dashboard} />
				</div>
			)}

			<AlertsCard alerts={alerts} />

			{errors && <ErrorLogTable data={errors} />}
		</div>
	);
}
