import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Eye, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { getMyResponses } from "@/api";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import EmptyState from "@/components/ui/empty-state";
import RecordSubPageLayout from "@/components/shell/RecordSubPageLayout";
import Pagination from "@/components/ui/pagination";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

type ResponseItem = components["schemas"]["QuestionnaireResponseItem"];

const LIKERT_LABELS = ["非常不同意", "不同意", "一般", "同意", "非常同意"];
const SATISFACTION_LABELS = ["非常不满意", "不满意", "一般", "满意", "非常满意"];
const LIMIT = 20;

function ResponseDetailModal({
	response: r,
	open,
	onClose,
}: {
	response: ResponseItem | null;
	open: boolean;
	onClose: () => void;
}) {
	if (!r) return null;
	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent title={r.template_title} maxWidth={700}>
			<div className="space-y-4">
				<div className="flex items-center gap-3 text-sm text-muted-foreground">
					<span>
						提交时间: {new Date(r.created_at).toLocaleString("zh-CN")}
					</span>
					<Badge variant={r.status === "completed" ? "success" : "info"}>
						{r.status === "completed" ? "已完成" : r.status}
					</Badge>
				</div>
				<div className="space-y-4">
					{(r.answers ?? []).map((a, idx) => (
						<div
							key={a.question_id}
							className="rounded-lg border border-border p-4"
						>
							<p className="text-sm font-medium mb-2">
								{idx + 1}. {a.question_content}
							</p>
							<div className="text-sm">
								{a.question_type === "likert_5" && a.answer_value && (
									<span className="text-primary font-semibold">
										{a.answer_value} -{" "}
										{LIKERT_LABELS[parseInt(a.answer_value, 10) - 1] ||
											a.answer_value}
									</span>
								)}
								{a.question_type === "satisfaction_5" && a.answer_value && (
									<span className="text-primary font-semibold">
										{a.answer_value} -{" "}
										{SATISFACTION_LABELS[parseInt(a.answer_value, 10) - 1] ||
											a.answer_value}
									</span>
								)}
								{a.question_type === "multiple_choice" && (
									<span className="text-primary font-semibold">
										{a.answer_value || (
											<span className="text-muted-foreground italic">
												未作答
											</span>
										)}
									</span>
								)}
								{a.question_type === "short_text" && (
									<span className="text-primary">
										{a.answer_value || (
											<span className="text-muted-foreground italic">
												未作答
											</span>
										)}
									</span>
								)}
							</div>
						</div>
					))}
				</div>
				{r.answers.length === 0 && <EmptyState title="暂无回答记录" />}
			</div>
			</DialogContent>
		</Dialog>
	);
}

export default function MyResponses() {
	const [offset, setOffset] = useState(0);
	const [statusFilter, setStatusFilter] = useState("");
	const [detailResponse, setDetailResponse] = useState<ResponseItem | null>(
		null,
	);

	const params: Record<string, unknown> = { offset, limit: LIMIT };

	const { data, isLoading, isError, error, refetch } = useQuery({
		queryKey: queryKeys.questionnaires.myResponses(params),
		queryFn: () => getMyResponses(params).then((r) => r.data),
		staleTime: 5 * 60_000,
	});

	const rawResponses = data?.items ?? [];
	const total = data?.total ?? 0;

	const responses = useMemo(() => {
		if (!statusFilter) return rawResponses;
		return rawResponses.filter((r) => r.status === statusFilter);
	}, [rawResponses, statusFilter]);

	return (
		<RecordSubPageLayout title="我的问卷回答" subtitle="查看你提交过的前后测问卷回答记录" icon={ClipboardCheck}>
			<div className="flex items-center gap-2 mb-4">
				<select
					value={statusFilter}
					onChange={(e) => { setStatusFilter(e.target.value); setOffset(0); }}
					className="py-1.5 px-2.5 border border-border rounded-lg text-sm bg-card"
				>
					<option value="">全部状态</option>
					<option value="completed">已完成</option>
					<option value="in_progress">进行中</option>
				</select>
			</div>

			<div className="space-y-4">
				{isLoading ? (
					<LoadingSkeleton variant="spinner" message="加载中..." />
				) : isError ? (
					<div className="flex flex-col items-center justify-center py-20 gap-3 rounded-xl border bg-card">
						<ClipboardCheck size={40} className="text-muted-foreground/40" />
						<p className="text-sm text-destructive">
							{(error as { response?: { data?: { detail?: string } } })
								?.response?.data?.detail || "加载失败"}
						</p>
						<Button variant="outline" size="sm" onClick={() => refetch()}>
							<RefreshCw size={14} className="mr-1.5" />
							重试
						</Button>
					</div>
				) : responses.length === 0 ? (
					<div className="rounded-xl border bg-card">
						<EmptyState
							icon={ClipboardCheck}
							title="暂无问卷回答记录"
							description="完成训练的前后测问卷后，回答记录会显示在这里"
						/>
					</div>
				) : (
					<div className="rounded-xl border bg-card overflow-hidden">
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow className="bg-muted/50">
										<TableHead className="font-semibold text-xs uppercase tracking-wider">
											问卷标题
										</TableHead>
										<TableHead className="font-semibold text-xs uppercase tracking-wider">
											提交时间
										</TableHead>
										<TableHead className="font-semibold text-xs uppercase tracking-wider">
											状态
										</TableHead>
										<TableHead className="font-semibold text-xs uppercase tracking-wider">
											题数
										</TableHead>
										<TableHead className="font-semibold text-xs uppercase tracking-wider">
											操作
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{responses.map((r) => (
										<TableRow key={r.id}>
											<TableCell className="font-medium">
												{r.template_title}
											</TableCell>
											<TableCell className="text-xs text-muted-foreground">
												{new Date(
													r.completed_at || r.created_at,
												).toLocaleString("zh-CN")}
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
											<TableCell className="text-muted-foreground">
												{r.answers.length} 题
											</TableCell>
											<TableCell>
												<Button
													variant="link"
													size="xs"
													onClick={() => setDetailResponse(r)}
												>
													<Eye size={14} className="mr-1" />
													查看回答
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					</div>
				)}
				{total > LIMIT && (
					<div className="rounded-xl border bg-card px-4 py-3">
						<Pagination
							total={total}
							offset={offset}
							limit={LIMIT}
							onChange={setOffset}
						/>
					</div>
				)}
			</div>

			<ResponseDetailModal
				response={detailResponse}
				open={detailResponse !== null}
				onClose={() => setDetailResponse(null)}
			/>
		</RecordSubPageLayout>
	);
}
