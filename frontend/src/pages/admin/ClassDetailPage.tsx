import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Award, GraduationCap, Target, TrendingUp, User } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { getClass, getClassSummary } from "@/api/grades-classes";
import { getRecords } from "@/api";
import { queryKeys } from "@/api/query-keys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import StatCard from "@/components/ui/stat-card";
import { cn } from "@/lib/utils";

export default function ClassDetailPage() {
	const { classId } = useParams<{ classId: string }>();
	const navigate = useNavigate();
	const cid = Number(classId);

	const { data: cls, isLoading: clsLoading } = useQuery({
		queryKey: queryKeys.grades.classDetail(cid),
		queryFn: () => getClass(cid).then((r) => r.data),
		enabled: !!cid,
	});

	const { data: summary } = useQuery({
		queryKey: queryKeys.grades.classSummary(cid),
		queryFn: () => getClassSummary({ class_id: cid }),
		enabled: !!cid,
	});

	const { data: records } = useQuery({
		queryKey: queryKeys.training.classRecords(cid),
		queryFn: () => getRecords({ class_id: cid, limit: 200 }).then((r) => r.data),
		enabled: !!cid,
	});

	if (clsLoading) return <LoadingSkeleton />;
	if (!cls) return <div className="p-8 text-center text-muted-foreground">班级不存在</div>;

	const items = records?.items ?? [];
	const clsSummary = Array.isArray(summary) ? summary.find((s: { class_id: number }) => s.class_id === cid) : null;

	const studentMap = new Map<number, { name: string; id: number; total: number; avgScore: number | null; lastDate: string | null }>();
	for (const r of items) {
			const uid = (r as unknown as { user_id: number }).user_id;
			const name = (r as unknown as { user_display_name?: string }).user_display_name || `用户${uid}`;
		const score = (r as { score?: { total_score?: number } | null }).score?.total_score;
		const existing = studentMap.get(uid);
		if (existing) {
			existing.total++;
			if (score != null) existing.avgScore = ((existing.avgScore ?? 0) * (existing.total - 1) + score) / existing.total;
		} else {
			studentMap.set(uid, { name, id: uid, total: 1, avgScore: score ?? null, lastDate: (r as unknown as { start_time?: string }).start_time ?? null });
		}
	}
	const students = [...studentMap.values()].sort((a, b) => b.total - a.total);

	return (
		<div className="max-w-6xl mx-auto p-4 space-y-6">
			<div className="flex items-center gap-2">
				<button onClick={() => navigate("/admin/grades-classes")} className="size-9 rounded-lg border border-border bg-card text-muted-foreground flex items-center justify-center shrink-0 hover:bg-muted">
					<ArrowLeft size={16} />
				</button>
				<div>
					<h1 className="text-lg font-bold">{cls.name}</h1>
					<p className="text-xs text-muted-foreground">{cls.grade_name}</p>
				</div>
			</div>

			<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
				<StatCard icon={User} label="学生数" value={students.length} />
				<StatCard icon={Target} label="训练总数" value={clsSummary?.total_sessions ?? items.length} />
				<StatCard icon={Award} label="平均得分" value={clsSummary?.avg_score != null ? `${clsSummary.avg_score}分` : "--"} />
				<StatCard icon={TrendingUp} label="完成率" value={clsSummary?.completion_rate != null ? `${clsSummary.completion_rate}%` : "--"} />
			</div>

			<Card>
				<CardHeader><CardTitle className="flex items-center gap-2"><GraduationCap size={16} />学生列表</CardTitle></CardHeader>
				<CardContent>
					{students.length === 0 ? (
						<EmptyState icon={GraduationCap} title="暂无学生" description="该班级尚无训练记录" />
					) : (
						<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
							{students.map((s) => (
								<button
									key={s.id}
									onClick={() => navigate(`/admin/records?user_id=${s.id}`)}
									className={cn(
										"flex items-center gap-3 p-3 rounded-xl border border-border bg-card text-left hover:border-primary/30 hover:bg-muted/50 transition-colors",
									)}
								>
									<div className="size-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
										<User size={18} className="text-primary" />
									</div>
									<div className="min-w-0 flex-1">
										<div className="text-sm font-medium truncate">{s.name}</div>
										<div className="text-xs text-muted-foreground">
											{s.total} 次训练
											{s.avgScore != null && ` · 均分 ${Math.round(s.avgScore)}`}
										</div>
									</div>
								</button>
							))}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
