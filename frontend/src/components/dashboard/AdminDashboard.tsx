import {
	BookOpen,
	CheckCircle,
	ClipboardList,
	TrendingUp,
	Users,
} from "lucide-react";
import type { components } from "@/api/api-types.gen";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import StatCard from "@/components/ui/stat-card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { RecordExtended } from "@/types/record";
import { cn } from "@/utils/cn";

type AdminStats = components["schemas"]["AdminStats"];

export default function AdminDashboard({
	stats,
	records,
	navigate,
}: {
	stats: AdminStats | null;
	records: RecordExtended[];
	navigate: (path: string) => void;
}) {
	const totalStudents = stats?.total_students ?? 0;
	const totalRecords = stats?.total_records ?? 0;
	const completedRecords = stats?.completed_records ?? 0;
	const todayRecords = stats?.today_records ?? 0;
	const completionRate =
		totalRecords > 0 ? Math.round((completedRecords / totalRecords) * 100) : 0;

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h1 className="text-lg font-semibold text-foreground">管理概览</h1>
				<p className="text-sm text-muted-foreground mt-0.5">
					全局概览：学生训练情况、系统数据、快捷管理入口
				</p>
			</div>

			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<StatCard
					icon={Users}
					value={totalStudents || "-"}
					label="学生总数"
					color="blue"
					onClick={() => navigate("/admin/users")}
				/>
				<StatCard
					icon={ClipboardList}
					value={totalRecords || "-"}
					label="总训练次数"
					color="teal"
				/>
				<StatCard
					icon={CheckCircle}
					value={`${completionRate}%`}
					label="完成率"
					color="green"
				/>
				<StatCard
					icon={TrendingUp}
					value={todayRecords || "-"}
					label="今日训练"
					color="amber"
				/>
			</div>

			<Card size="sm">
				<CardHeader className="pb-3">
					<CardTitle className="text-sm">快捷入口</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
						<Button
							variant="outline"
							className="justify-start h-auto py-3"
							onClick={() => navigate("/admin/users")}
						>
							<Users size={15} className="mr-2 shrink-0" />
							<span className="text-sm">用户管理</span>
						</Button>
						<Button
							variant="outline"
							className="justify-start h-auto py-3"
							onClick={() => navigate("/admin/cases")}
						>
							<BookOpen size={15} className="mr-2 shrink-0" />
							<span className="text-sm">病例库</span>
						</Button>
						<Button
							variant="outline"
							className="justify-start h-auto py-3"
							onClick={() => navigate("/admin/assignments")}
						>
							<ClipboardList size={15} className="mr-2 shrink-0" />
							<span className="text-sm">作业管理</span>
						</Button>
						<Button
							variant="outline"
							className="justify-start h-auto py-3"
							onClick={() => navigate("/admin/costs?tab=monitor")}
						>
							<TrendingUp size={15} className="mr-2 shrink-0" />
							<span className="text-sm">LLM 监控</span>
						</Button>
					</div>
				</CardContent>
			</Card>

			<Card size="sm">
				<CardHeader className="flex-row items-center justify-between border-b pb-4">
					<CardTitle className="flex items-center gap-2">
						<ClipboardList size={17} />
						最近训练动态
					</CardTitle>
					<CardAction>
						<Button
							variant="link"
							size="sm"
							onClick={() => navigate("/history")}
						>
							查看全部 →
						</Button>
					</CardAction>
				</CardHeader>
				{records.length > 0 ? (
					<div className="max-h-96 overflow-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>学生</TableHead>
									<TableHead>病例</TableHead>
									<TableHead>状态</TableHead>
									<TableHead>得分</TableHead>
									<TableHead />
								</TableRow>
							</TableHeader>
							<TableBody>
								{records.slice(0, 10).map((r) => (
									<TableRow key={r.id}>
										<TableCell className="font-medium">{r.user_display_name}</TableCell>
										<TableCell className="text-muted-foreground">{r.case_name}</TableCell>
										<TableCell>
											<Badge
												variant={
													r.status === "completed" ? "success" : "info"
												}
											>
												{r.status === "completed" ? "已完成" : "进行中"}
											</Badge>
										</TableCell>
										<TableCell>
											{r.score_total != null ? (
												<span
													className={cn(
														"font-semibold",
														r.score_total >= 85
															? "text-emerald-600"
															: r.score_total >= 70
																? "text-blue-600"
																: r.score_total >= 60
																	? "text-amber-600"
																	: "text-red-500",
													)}
												>
													{r.score_total}分
												</span>
											) : (
												<span className="text-muted-foreground">-</span>
											)}
										</TableCell>
										<TableCell>
											<Button
												variant="link"
												size="sm"
												onClick={() => navigate(`/record/${r.id}`)}
											>
												详情
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				) : (
					<CardContent className="text-center py-10 text-muted-foreground">
						<EmptyState icon={ClipboardList} title="暂无训练记录" />
					</CardContent>
				)}
			</Card>
		</div>
	);
}
