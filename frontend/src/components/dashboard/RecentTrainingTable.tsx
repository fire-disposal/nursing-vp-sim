import { ClipboardList } from "lucide-react";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/utils/cn";

interface RecordBrief {
	id: number;
	case_name: string;
	start_time: string;
	status: string;
	score_total?: number | null;
	training_type?: string;
}

export default function RecentTrainingTable({
	records,
	navigate,
}: {
	records: RecordBrief[];
	navigate: (path: string, opts?: { state?: Record<string, unknown> }) => void;
}) {
	if (records.length === 0) return null;

	return (
		<Card size="sm">
			<CardHeader className="flex-row items-center justify-between border-b pb-4">
				<CardTitle className="flex items-center gap-2">
					<ClipboardList size={17} />
					最近训练记录
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

			{/* Desktop table */}
			<div className="hidden md:block max-h-96 overflow-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>病例</TableHead>
							<TableHead>训练类型</TableHead>
							<TableHead>时间</TableHead>
							<TableHead>状态</TableHead>
							<TableHead>得分</TableHead>
							<TableHead />
						</TableRow>
					</TableHeader>
					<TableBody>
						{records.map((r) => (
							<TableRow key={r.id}>
								<TableCell>{r.case_name}</TableCell>
								<TableCell className="text-sm text-muted-foreground">
									{r.training_type === "triage" ? "分诊" : r.training_type === "history_taking" ? "问诊" : r.training_type || "-"}
								</TableCell>
								<TableCell className="text-muted-foreground">
									{new Date(r.start_time).toLocaleDateString("zh-CN")}
								</TableCell>
								<TableCell>
									<Badge
										variant={
											r.status === "completed" ? "success" : "info"
										}
									>
										{r.status === "completed" ? "已完成" : "进行中"}
									</Badge>
								</TableCell>
								<TableCell
									className={cn(
										"font-semibold",
										r.score_total != null
											? "text-primary"
											: "text-muted-foreground",
									)}
								>
									{r.score_total != null ? `${r.score_total}分` : "-"}
								</TableCell>
								<TableCell>
									<div className="flex items-center gap-3">
										<Button
											variant="link"
											size="sm"
											onClick={() => navigate(`/record/${r.id}`)}
										>
											详情
										</Button>
										{r.status === "in_progress" && (
											<Button
												variant="link"
												size="sm"
												onClick={() => navigate(`/training/${r.id}`)}
											>
												继续训练
											</Button>
										)}
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			{/* Mobile card list */}
			<div className="md:hidden divide-y">
				{records.map((r) => (
					<div key={r.id} className="px-4 py-3 space-y-2">
						<div className="flex items-start justify-between gap-2">
							<div className="min-w-0 flex-1">
								<div className="text-sm font-medium truncate">{r.case_name}</div>
								<div className="text-xs text-muted-foreground">
									{r.training_type === "triage" ? "分诊" : r.training_type === "history_taking" ? "问诊" : r.training_type || ""}
									{r.training_type ? " · " : ""}
									{new Date(r.start_time).toLocaleDateString("zh-CN")}
								</div>
							</div>
							<Badge
								variant={r.status === "completed" ? "success" : "info"}
							>
								{r.status === "completed" ? "已完成" : "进行中"}
							</Badge>
						</div>
						<div className="flex items-center justify-between">
							<span className={cn(
								"text-sm font-semibold",
								r.score_total != null ? "text-primary" : "text-muted-foreground",
							)}>
								{r.score_total != null ? `${r.score_total}分` : "未评分"}
							</span>
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									onClick={() => navigate(`/record/${r.id}`)}
								>
									详情
								</Button>
								{r.status === "in_progress" && (
									<Button
										variant="link"
										size="sm"
										onClick={() => navigate(`/training/${r.id}`)}
									>
										继续
									</Button>
								)}
							</div>
						</div>
					</div>
				))}
			</div>
		</Card>
	);
}
