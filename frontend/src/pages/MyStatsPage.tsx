import { useQuery } from "@tanstack/react-query";
import { Award, BarChart3, Clock, Target, TrendingUp } from "lucide-react";
import { getStudentRanking, getTrends } from "@/api";
import { queryKeys } from "@/api/query-keys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import StatCard from "@/components/ui/stat-card";

export default function MyStatsPage() {
	const { data: ranking } = useQuery({
		queryKey: queryKeys.stats.ranking({}),
		queryFn: () => getStudentRanking().then((r) => r.data),
	});

	const { data: trends } = useQuery({
		queryKey: queryKeys.stats.trends("month"),
		queryFn: () => getTrends().then((r) => r.data),
	});

	const myStats = ranking?.items?.[0];
	const trendItems = trends?.daily ?? [];
	if (!myStats) return null;

	return (
		<div className="max-w-4xl mx-auto p-4 space-y-6">
			<h1 className="text-lg font-bold">我的训练统计</h1>

			<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
				<StatCard icon={Target} label="完成训练" value={myStats.total_sessions ?? 0} />
				<StatCard icon={Award} label="平均得分" value={myStats.avg_score != null ? `${myStats.avg_score}分` : "--"} />
				<StatCard icon={TrendingUp} label="排名" value={myStats.rank ? `第${myStats.rank}名` : "--"} />
				<StatCard icon={Clock} label="总时长" value={myStats.total_minutes ? `${myStats.total_minutes}分钟` : "--"} />
			</div>

			{trendItems.length > 0 ? (
				<Card>
					<CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 size={16} />进步趋势</CardTitle></CardHeader>
					<CardContent>
						<div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
							{trendItems.slice(0, 8).map((t, i) => {
								const score = t.average_score as number | undefined;
								const label = t.period_label as string | undefined;
								return (
								<div key={i} className="space-y-1">
									<div className="text-2xl font-bold">{score != null ? score : "--"}</div>
									<div className="text-xs text-muted-foreground">{label ?? `第${i + 1}周`}</div>
								</div>
								);
							})}
						</div>
					</CardContent>
				</Card>
			) : (
				<EmptyState icon={BarChart3} title="暂无趋势数据" description="完成更多训练后这里会显示进步趋势" />
			)}
		</div>
	);
}
