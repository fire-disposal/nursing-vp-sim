import { ArrowLeft, Download } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { exportAssignment, getAssignment } from "@/api/assignments";
import { useToast } from "@/components/Toast";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LoadingSkeleton from "@/components/ui/LoadingSkeleton";
import PageHeader from "@/components/ui/PageHeader";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useApiQuery } from "@/hooks/useApiQuery";

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

	const { data, isLoading, error } = useApiQuery({
		queryKey: ["assignment", id],
		queryFn: () => getAssignment(id!),
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

			<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
							未完成
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold text-muted-foreground">
							{detail.student_count - detail.completed_count}
						</div>
					</CardContent>
				</Card>
			</div>

			<Card className="overflow-hidden">
				<CardHeader className="pb-3">
					<CardTitle>学生完成情况</CardTitle>
				</CardHeader>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>学号</TableHead>
							<TableHead>姓名</TableHead>
							<TableHead>状态</TableHead>
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
								<TableCell>
									{s.score_total != null ? (
										<span className="font-bold">{s.score_total}</span>
									) : (
										"-"
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
								</TableCell>
							</TableRow>
						))}
						{(!detail.students || detail.students.length === 0) && (
							<TableRow>
								<TableCell
									colSpan={6}
									className="text-center text-muted-foreground py-8"
								>
									该班级暂无学生
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</Card>
		</div>
	);
}
