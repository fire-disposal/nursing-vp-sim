import { useQuery } from "@tanstack/react-query";
import { DollarSign, Hash, Percent, Volume2 } from "lucide-react";
import { fetchVoiceUsage } from "@/api/admin/voice-cost";
import { queryKeys } from "@/api/query-keys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StatCard from "@/components/ui/stat-card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/utils/cn";
import VoiceTokenCard from "./VoiceTokenCard";

function TTSUsageTable() {
	const { data: usage } = useQuery({
		queryKey: queryKeys.voice.usage,
		queryFn: () => fetchVoiceUsage().then((r) => r.data),
		staleTime: 60_000,
	});

	const ttsData = usage
		? [
				{ label: "今日", ...usage.tts_today },
				{ label: "本月", ...usage.tts_month },
			]
		: [];

	return (
		<Card>
			<CardHeader>
				<CardTitle>TTS 使用统计</CardTitle>
			</CardHeader>
			<CardContent>
				{ttsData.length === 0 ? (
					<div className="text-muted-foreground text-sm text-center py-4">暂无数据</div>
				) : (
					<>
						{/* 宽屏表格 */}
						<div className="hidden sm:block">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>周期</TableHead>
									<TableHead className="text-right">调用</TableHead>
									<TableHead className="text-right">成功</TableHead>
									<TableHead className="text-right">失败</TableHead>
									<TableHead className="text-right">字符</TableHead>
									<TableHead className="text-right">费用</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{ttsData.map((row) => (
									<TableRow key={row.label}>
										<TableCell className="font-medium">{row.label}</TableCell>
										<TableCell className="text-right tabular-nums">{row.calls_total}</TableCell>
										<TableCell className="text-right tabular-nums text-emerald-600">{row.calls_success}</TableCell>
										<TableCell className="text-right tabular-nums text-danger-foreground">{row.calls_error}</TableCell>
										<TableCell className="text-right tabular-nums">{row.total_chars.toLocaleString()}</TableCell>
										<TableCell className="text-right tabular-nums font-medium">¥{row.cost_estimated.toFixed(4)}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
						</div>
						{/* 窄屏卡片 */}
						<div className="sm:hidden space-y-2">
							{ttsData.map((row) => (
								<div key={row.label} className="rounded-lg border border-border p-3 space-y-1">
									<div className="text-sm font-medium">{row.label}</div>
									<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
										<span>调用 {row.calls_total}</span>
										<span className="text-emerald-600">成功 {row.calls_success}</span>
										<span className="text-danger-foreground">失败 {row.calls_error}</span>
										<span>字符 {row.total_chars.toLocaleString()}</span>
										<span className="font-medium text-foreground">¥{row.cost_estimated.toFixed(4)}</span>
									</div>
								</div>
							))}
						</div>
					</>
				)}
			</CardContent>
		</Card>
	);
}

export default function VoiceTTSTab() {
	const { data: usage } = useQuery({
		queryKey: queryKeys.voice.usage,
		queryFn: () => fetchVoiceUsage().then((r) => r.data),
		staleTime: 60_000,
	});

	const ttsToday = usage?.tts_today;
	const ttsMonth = usage?.tts_month;
	const budget = usage?.monthly_budget ?? 0;
	const monthUsed = usage?.monthly_used ?? 0;
	const budgetUsed = budget > 0 ? Math.min(100, Math.round((monthUsed / budget) * 100)) : 0;

	const todaySuccessRate = ttsToday && ttsToday.calls_total > 0
		? `${((ttsToday.calls_success / ttsToday.calls_total) * 100).toFixed(1)}%`
		: "0%";

	return (
		<div className="space-y-6 mt-4">
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
				<StatCard icon={DollarSign} value={`¥${(ttsToday?.cost_estimated ?? 0).toFixed(2)}`} label="今日费用" color="teal" />
				<StatCard icon={DollarSign} value={`¥${(ttsMonth?.cost_estimated ?? 0).toFixed(2)}`} label="本月费用" color="blue" />
				<StatCard icon={Hash} value={ttsToday?.calls_total ?? 0} label="今日调用" color="amber" />
				<StatCard icon={Percent} value={todaySuccessRate} label="今日成功率" color="green" />
			</div>

			{budget > 0 && (
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm flex items-center gap-2">
							<Volume2 size={15} />
							月度预算
							<span className="text-muted-foreground font-normal">
								¥{monthUsed.toFixed(2)} / ¥{budget.toFixed(0)}
							</span>
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="h-2 rounded-full bg-muted overflow-hidden">
							<div
								className={cn(
									"h-full rounded-full transition-all duration-700",
									budgetUsed > 90 ? "bg-danger" : budgetUsed > 70 ? "bg-warning" : "bg-success",
								)}
								style={{ width: `${budgetUsed}%` }}
							/>
						</div>
						<div className="text-[10px] text-muted-foreground mt-1 text-right">{budgetUsed}%</div>
					</CardContent>
				</Card>
			)}

			<VoiceTokenCard />

			<TTSUsageTable />
		</div>
	);
}
