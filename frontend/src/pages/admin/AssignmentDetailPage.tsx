import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { exportAssignment, getAssignment } from "@/api/assignments";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

function statusBadge(status: string) {
	switch (status) {
		case "not_started":
			return <Badge variant="secondary">未开始</Badge>;
		case "in_progress":
			return (
				<span className="inline-flex items-center rounded-full bg-info px-2 py-0.5 text-xs font-medium text-info-foreground">
					进行中
				</span>
			);
		case "completed":
			return (
				<span className="inline-flex items-center rounded-full bg-success px-2 py-0.5 text-xs font-medium text-success-foreground">
					已完成
				</span>
			);
		case "overdue":
			return <Badge variant="destructive">已逾期</Badge>;
		default:
			return <Badge variant="secondary">{status}</Badge>;
	}
}

export default function AssignmentDetailPage() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const toast = useToast();

	const { data, isLoading, error } = useQuery({
		queryKey: queryKeys.assignments.detail(id),
		queryFn: () => getAssignment(id!).then((r) => r.data),
		enabled: !!id,
		staleTime: 2 * 60_000,
	});

	const handleExport = async () => {
		if (!id) return;
		try {
			const res = await exportAssignment(id);
			const blob = new Blob([res.data as unknown as BlobPart], {
				type: "text/csv; charset=utf-8-sig",
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `assignment_${id.slice(0, 8)}.csv`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success("导出成功");
		} catch (e: any) {
			toast.error(e.message || "导出失败");
		}
	};

	if (isLoading) return <LoadingSkeleton />;
	if (error || !data)
		return (
			<div className="p-8 text-center text-muted-foreground">加载失败</div>
		);

	const detail = data;

	return (
		<div className="space-y-6">
			<PageHeader
				title={detail.title}
				subtitle={
					detail.description
						? `${detail.practice_name} · ${detail.class_name} · ${detail.description}`
						: `${detail.practice_name} · ${detail.class_name}`
				}
				actions={
					<div className="flex gap-2">
						<Button
							variant="outline"
							onClick={() => navigate("/admin/assignments")}
						>
							<ArrowLeft size={16} className="mr-1" />
							返回
						</Button>
						<Button onClick={handleExport}>
							<Download size={16} className="mr-1" />
							导出成绩
						</Button>
					</div>
				}
			/>

			<div className="grid grid-cols-2 md:grid-cols-5 gap-4">
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-xs font-medium text-muted-foreground">
							总人数
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{detail.student_count}</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-xs font-medium text-muted-foreground">
							已完成
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold text-success-foreground">
							{detail.completed_count}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-xs font-medium text-muted-foreground">
							已评分
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold text-primary">
							{detail.scored_count}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-xs font-medium text-muted-foreground">
							完成率
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">
							{`${(detail as any).completion_rate != null
								? ((detail as any).completion_rate as number * 100).toFixed(0)
								: "-"}%`}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-xs font-medium text-muted-foreground">
							均分/最高
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-lg font-bold">
							{(detail as any).avg_score != null ? (detail as any).avg_score : "-"}
						</div>
						<div className="text-xs text-muted-foreground">
							最高 {(detail as any).max_score ?? "-"} / 最低 {(detail as any).min_score ?? "-"}
						</div>
					</CardContent>
				</Card>
			</div>

			{(detail as any).avg_score != null && (
				<Card className="mt-4">
					<CardHeader className="pb-2">
						<CardTitle className="text-sm">分数分布</CardTitle>
					</CardHeader>
					<CardContent>
						<ScoreDistributionBar students={(detail.students || []) as any[]} />
					</CardContent>
				</Card>
			)}

			<Card className="overflow-hidden">
				<CardHeader className="pb-3">
					<CardTitle>学生完成情况</CardTitle>
				</CardHeader>
				<div className="overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>学号</TableHead>
							<TableHead>姓名</TableHead>
							<TableHead>状态</TableHead>
							<TableHead>尝试次数</TableHead>
							<TableHead>得分</TableHead>
							<TableHead>评分状态</TableHead>
							<TableHead>完成时间</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{(detail.students as any[] | undefined)?.map((s: any) => (
							<TableRow key={s.user_id}>
								<TableCell className="text-xs font-mono">
									{s.student_id || "-"}
								</TableCell>
								<TableCell className="font-medium">{s.display_name}</TableCell>
								<TableCell>{statusBadge(s.status)}</TableCell>
								<TableCell className="text-xs text-muted-foreground">{s.attempt_count > 0 ? s.attempt_count : "-"}</TableCell>
								<TableCell>
									{s.score_total != null ? (
										<span className="font-bold">{s.score_total}</span>
									) : (
										"-"
									)}
									{s.attempt_count > 1 && (
										<span className="ml-1 text-[10px] text-muted-foreground">
											共{s.attempt_count}次
										</span>
									)}
								</TableCell>
								<TableCell className="text-xs text-muted-foreground">
									{s.scoring_status === "completed"
										? "已评分"
										: s.scoring_status || "-"}
								</TableCell>
								<TableCell className="text-xs text-muted-foreground">
									{s.end_time
										? new Date(s.end_time).toLocaleString("zh-CN")
										: "-"}
									{s.status === "completed" && s.is_overdue && (
										<span className="ml-1 text-[10px] text-destructive">逾期提交</span>
									)}
								</TableCell>
							</TableRow>
						))}
						{(!detail.students || detail.students.length === 0) && (
							<TableRow>
								<TableCell
									colSpan={7}
									className="text-center text-muted-foreground py-8"
								>
									该班级暂无学生
								</TableCell>
							</TableRow>
						)}
			</TableBody>
		</Table>
		</div>
	</Card>
		</div>
	);
}

function ScoreDistributionBar({ students }: { students: { score_total?: number | null; scoring_status?: string | null }[] }) {
	const scored = students
		.filter((s) => s.scoring_status === "completed" && s.score_total != null)
		.map((s) => s.score_total!);
	if (scored.length === 0) return <p className="text-xs text-muted-foreground">暂无评分数据</p>;
	const buckets = [
		{ label: "0-59", lo: 0, hi: 59 },
		{ label: "60-69", lo: 60, hi: 69 },
		{ label: "70-79", lo: 70, hi: 79 },
		{ label: "80-89", lo: 80, hi: 89 },
		{ label: "90-100", lo: 90, hi: 100 },
	];
	const counts = buckets.map((b) => scored.filter((s) => s >= b.lo && s <= b.hi).length);
	const max = Math.max(...counts, 1);
	return (
		<div className="space-y-1.5">
			{buckets.map((b, i) => (
				<div key={b.label} className="flex items-center gap-2 text-xs">
					<span className="w-10 text-right text-muted-foreground">{b.label}</span>
					<div className="flex-1 h-5 bg-muted rounded">
						<div className="h-full bg-primary rounded transition-all" style={{ width: `${(counts[i] / max) * 100}%` }} />
					</div>
					<span className="w-6 text-right">{counts[i]}</span>
				</div>
			))}
		</div>
	);
}
