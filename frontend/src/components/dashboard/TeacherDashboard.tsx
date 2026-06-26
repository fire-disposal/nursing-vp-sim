import {
	BookOpen,
	CheckCircle,
	ClipboardList,
	Clock,
	Download,
	Settings,
	Star,
	Target,
	TrendingUp,
	Users,
} from "lucide-react";
import type { components } from "@/api/api-types.gen";
import TrainingDurationChart from "@/components/dashboard/TrainingDurationChart";
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
import { cn } from "@/utils/cn";
import type { ScoreData } from "@/types/score";

type AdminStats = components["schemas"]["AdminStats"];

interface RecordExtended {
	id: number;
	case_id: number;
	case_name: string;
	user_display_name?: string;
	start_time: string;
	end_time: string | null;
	status: string;
	score_total?: number | null;
	scoring_status?: string | null;
	scoring_error?: string | null;
	score?: ScoreData | null;
}

export default function TeacherDashboard({
	stats,
	records,
	handleExport,
	navigate,
}: {
	stats: AdminStats | null;
	records: RecordExtended[];
	handleExport: () => void;
	navigate: (path: string) => void;
}) {
	const recentRecords = records.slice(0, 5);

	return (
		<>
			<PageHeader
				title="教学仪表盘"
				subtitle="全局概览：学生训练情况、系统数据、快捷管理入口"
				icon={Target}
				actions={
					<div className="flex gap-2">
						<Button onClick={() => navigate("/admin")}>
							<Settings size={16} /> 管理后台
						</Button>
						<Button variant="outline" onClick={handleExport}>
							<Download size={16} /> 导出CSV
						</Button>
					</div>
				}
			/>

			<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 mb-6">
				<StatCard
					icon={Users}
					value={stats?.total_students ?? "-"}
					label="学生总数"
					color="blue"
					onClick={() => navigate("/admin")}
				/>
				<StatCard
					icon={ClipboardList}
					value={stats?.total_records ?? "-"}
					label="总训练次数"
					color="teal"
					onClick={() => navigate("/history")}
				/>
				<StatCard
					icon={CheckCircle}
					value={stats?.completed_records ?? "-"}
					label="已完成训练"
					color="green"
				/>
				<StatCard
					icon={Star}
					value={stats?.average_score ?? "-"}
					label="平均得分"
					color="amber"
					onClick={() => navigate("/stats")}
				/>
				<StatCard
					icon={Clock}
					value={stats?.avg_duration_min ?? "-"}
					label="平均时长(分钟)"
					color="blue"
				/>
			</div>

			<TrainingDurationChart />

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px] items-start mt-6">
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
					{recentRecords.length > 0 ? (
						<div className="max-h-96 overflow-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>学生</TableHead>
										<TableHead>病例</TableHead>
										<TableHead>状态</TableHead>
										<TableHead>时间</TableHead>
										<TableHead>得分</TableHead>
										<TableHead />
									</TableRow>
								</TableHeader>
								<TableBody>
									{recentRecords.map((r) => (
										<TableRow key={r.id}>
											<TableCell>{r.user_display_name}</TableCell>
											<TableCell>{r.case_name}</TableCell>
											<TableCell>
												<Badge
													variant={
														r.status === "completed" ? "success" : "info"
													}
												>
													{r.status === "completed" ? "已完成" : "进行中"}
												</Badge>
											</TableCell>
											<TableCell className="text-muted-foreground">
												{new Date(r.start_time).toLocaleString("zh-CN")}
											</TableCell>
											<TableCell>
												{r.score_total != null ? (
													<span
														className={cn(
															"font-semibold",
														r.score_total >= 85
															? "text-success-foreground"
															: r.score_total >= 70
																? "text-primary"
																: r.score_total >= 60
																	? "text-warning-foreground"
																	: "text-danger-foreground",
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

				<div className="flex flex-col gap-4">
					<Card size="sm">
						<CardHeader className="pb-3">
							<CardTitle className="text-sm">快捷入口</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="flex flex-col gap-2">
								<Button
									variant="outline"
									className="justify-start"
									onClick={() => navigate("/history")}
								>
									<ClipboardList size={14} /> 训练记录管理
								</Button>
								<Button
									variant="outline"
									className="justify-start"
									onClick={() => navigate("/admin/users")}
								>
									<Users size={14} /> 学生账号管理
								</Button>
								<Button
									variant="outline"
									className="justify-start"
									onClick={() => navigate("/admin/cases")}
								>
									<BookOpen size={14} /> 病例库管理
								</Button>
								<Button
									variant="outline"
									className="justify-start"
									onClick={() => navigate("/admin/llm")}
								>
									<TrendingUp size={14} /> LLM 调用监控
								</Button>
							</div>
						</CardContent>
					</Card>

					<Card size="sm">
						<CardHeader className="pb-3">
							<CardTitle className="text-sm">数据概况</CardTitle>
						</CardHeader>
						<CardContent>
							<div className="flex flex-col gap-2 text-sm">
								<div className="flex justify-between">
									<span className="text-muted-foreground">学生总数</span>
									<strong>{stats?.total_students ?? "-"}</strong>
								</div>
								<div className="flex justify-between">
									<span className="text-muted-foreground">训练完成率</span>
									<strong>
										{stats && stats.total_records > 0
											? `${Math.round((stats.completed_records / stats.total_records) * 100)}%`
											: "-"}
									</strong>
								</div>
								<div className="flex justify-between">
									<span className="text-muted-foreground">今日训练次数</span>
									<strong>{stats?.today_records ?? "-"}</strong>
								</div>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</>
	);
}
