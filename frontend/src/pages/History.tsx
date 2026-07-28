import RecordSubPageLayout from "@/components/shell/RecordSubPageLayout";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Play, Trash2, XCircle } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { abandonRecord, deleteRecord, getRecords } from "@/api";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import ErrorDisplay from "@/components/ui/error-display";
import { useConfirm } from "@/components/ui/confirm";
import EmptyState from "@/components/ui/empty-state";
import Pagination from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/utils/cn";

type TrainingRecordBrief = components["schemas"]["TrainingRecordBrief"];

const LIMIT = 50;

/** Extract repeated field access. Returns minutes or null. */
function recordDurMins(r: TrainingRecordBrief): number | null {
	if (!r.end_time) return null;
	return Math.round(
		(new Date(r.end_time).getTime() - new Date(r.start_time).getTime()) / 60000,
	);
}

/** Narrow status used in both mobile cards and desktop table. */
type RecordStatus = "completed" | "in_progress" | "abandoned";
function recordStatus(r: TrainingRecordBrief): RecordStatus {
	if (r.status === "completed" || r.status === "in_progress" || r.status === "abandoned")
		return r.status;
	return "in_progress"; // fallback
}

export default function History() {
	const [searchParams, setSearchParams] = useSearchParams();
	const navigate = useNavigate();
	const toast = useToast();
	const { confirm } = useConfirm();
	const queryClient = useQueryClient();

	const status = searchParams.get("status") || "";
	const date_from = searchParams.get("date_from") || "";
	const date_to = searchParams.get("date_to") || "";
	const offset = parseInt(searchParams.get("offset") || "0", 10);

	const setParam = useCallback(
		(key: string, value: string) => {
			const next = new URLSearchParams(searchParams);
			if (value) {
				next.set(key, value);
			} else {
				next.delete(key);
			}
			if (key !== "offset") next.set("offset", "0");
			setSearchParams(next, { replace: true });
		},
		[searchParams, setSearchParams],
	);

	const params = useMemo(() => {
		const p: Record<string, unknown> = { offset, limit: LIMIT };
		if (status) p.status = status;
		if (date_from) p.date_from = date_from;
		if (date_to) p.date_to = date_to;
		return p;
	}, [offset, status, date_from, date_to]);

	const { data, isLoading, isError, error, refetch } = useQuery({
		queryKey: queryKeys.training.records(params),
		queryFn: () => getRecords(params).then((r) => r.data),
		staleTime: 2 * 60_000,
		placeholderData: keepPreviousData,
	});

	const records = data?.items ?? [];
	const total = data?.total ?? 0;

	const deleteMutation = useMutation({
		mutationFn: (id: number) => deleteRecord(id),
		onSuccess: () => {
			toast.success("训练记录已删除");
			queryClient.invalidateQueries({ queryKey: queryKeys.training.all });
		},
		onError: (err: unknown) => {
			toast.apiError(err, "删除失败");
		},
	});

	const handleDeleteRecord = async (r: TrainingRecordBrief) => {
		const ok = await confirm({
			title: "删除记录",
			message: `确定删除「${r.case_name}」的训练记录吗？此操作不可撤销。`,
			confirmLabel: "确定删除",
			danger: true,
		});
		if (!ok) return;
		deleteMutation.mutate(r.id);
	};

	const abandonMutation = useMutation({
		mutationFn: (id: number) => abandonRecord(id),
		onSuccess: () => {
			toast.success("训练记录已放弃");
			queryClient.invalidateQueries({ queryKey: queryKeys.training.all });
		},
		onError: (err: unknown) => toast.apiError(err, "操作失败"),
	});

	const handleAbandonRecord = async (r: TrainingRecordBrief) => {
		const ok = await confirm({
			title: "放弃训练",
			message: `确定放弃「${r.case_name}」的训练吗？放弃后将保留对话记录但不会评分。`,
			confirmLabel: "确定放弃",
			danger: true,
		});
		if (!ok) return;
		abandonMutation.mutate(r.id);
	};

	const clearFilters = () => {
		setSearchParams({}, { replace: true });
	};

	return (
		<RecordSubPageLayout title="训练记录" icon={ClipboardList}>
			<div className="rounded-xl border bg-card p-3 sm:p-4 space-y-3">
				<div className="flex items-center gap-2 flex-wrap">
					<span className="text-xs text-muted-foreground shrink-0">共 {total} 条</span>
					{records.length > 0 && (
						<span className="text-xs text-muted-foreground shrink-0">
							· 已完成 {records.filter(r => r.status === "completed").length}
						</span>
					)}
					<div className="flex-1" />
					<Select value={status ?? "all"} onValueChange={(v) => setParam("status", v === "all" ? "" : v ?? "")}>
						<SelectTrigger className="h-8 w-[110px] text-xs">
							<SelectValue placeholder="全部状态" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">全部状态</SelectItem>
							<SelectItem value="in_progress">进行中</SelectItem>
							<SelectItem value="completed">已完成</SelectItem>
							<SelectItem value="abandoned">已放弃</SelectItem>
						</SelectContent>
					</Select>
					<input type="date" value={date_from} onChange={(e) => setParam("date_from", e.target.value)}
						className="h-8 rounded-md border border-input bg-background px-2 text-xs" />
					<input type="date" value={date_to} onChange={(e) => setParam("date_to", e.target.value)}
						className="h-8 rounded-md border border-input bg-background px-2 text-xs" />
					<Button variant="outline" size="xs" onClick={clearFilters}>清除</Button>
				</div>
			</div>

				{isLoading ? (
					<LoadingSkeleton variant="spinner" message="加载中..." />
				) : isError ? (
					<ErrorDisplay
						icon={ClipboardList}
						message={(error as { response?: { data?: { detail?: string } } })
							?.response?.data?.detail || "加载记录失败"}
						onRetry={() => refetch()}
					/>
				) : records.length === 0 ? (
					<div className="rounded-xl border bg-card">
						<EmptyState icon={ClipboardList} title="暂无训练记录" description="前往病例列表选择病例开始训练" />
					</div>
				) : (

					<div className="rounded-xl border bg-card overflow-hidden">
						{/* Mobile: card list */}
						<div className="space-y-2 p-2 md:hidden">
							{records.map((r) => {
								const durMins = recordDurMins(r);
								const status = recordStatus(r);
								return (
									<div
										key={r.id}
										className="rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/50 active:scale-[0.99]"
									>
										<button
											onClick={() => navigate(`/record/${r.id}`)}
											className="w-full text-left"
										>
											<div className="flex items-start justify-between gap-2">
												<div className="min-w-0 flex-1">
													<div className="flex items-center gap-2">
														<div className="text-sm font-semibold truncate">{r.case_name}</div>
														{r.assignment_title && (
															<span className="shrink-0 inline-flex items-center rounded bg-primary/10 px-1.5 py-px text-[10px] text-primary">作业</span>
														)}
													</div>
													<div className="text-xs text-muted-foreground mt-0.5">
														{new Date(r.start_time).toLocaleString("zh-CN", {
															month: "numeric", day: "numeric",
															hour: "2-digit", minute: "2-digit",
														})}
														 · 问诊
														{durMins != null ? ` · ${durMins} 分钟` : ""}
													</div>
												</div>
												<div className="flex items-center gap-2 shrink-0">
													{status === "completed" ? (
														<span className="text-xs tabular-nums font-semibold">
															{r.score_total != null ? `${r.score_total} 分` : "评分中"}
														</span>
													) : status === "abandoned" ? (
														<span className="text-xs text-muted-foreground">已放弃</span>
													) : (
														<Badge variant="info">进行中</Badge>
													)}
												</div>
											</div>
										</button>
										<div className="flex items-center gap-2 mt-2 pt-2 border-t border-border">
											{status === "in_progress" && (
												<>
													<Button
														variant="outline"
														size="sm"
														className="h-7 text-xs flex-1"
														onClick={(e) => {
															e.stopPropagation();
															navigate(`/training/${r.id}`);
														}}
													>
														<Play size={12} /> 继续
													</Button>
													<Button
														variant="ghost"
														size="sm"
														className="h-7 text-xs text-muted-foreground"
														onClick={(e) => {
															e.stopPropagation();
															handleAbandonRecord(r);
														}}
													>
														<XCircle size={12} /> 放弃
													</Button>
												</>
											)}
											{status === "abandoned" && (
												<Button
													variant="ghost"
													size="sm"
													className="h-7 text-xs flex-1"
													onClick={(e) => {
														e.stopPropagation();
														navigate(`/record/${r.id}`);
													}}
												>
													查看
												</Button>
											)}
											<Button
												variant="ghost"
												size="sm"
												className="h-7 text-xs text-destructive hover:text-destructive ml-auto"
												onClick={(e) => {
													e.stopPropagation();
													handleDeleteRecord(r);
												}}
											>
												<Trash2 size={12} /> 删除
											</Button>
										</div>
									</div>
								);
							})}
						</div>

						<div className="overflow-x-auto hidden md:block">
							<Table>
								<TableHeader>
									<TableRow className="bg-muted/50">
										<TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider">
											病例
										</TableHead>
										<TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider">
											类型
										</TableHead>
										<TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider">
											来源
										</TableHead>
										<TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider hidden sm:table-cell">
											开始时间
										</TableHead>
										<TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider hidden sm:table-cell">
											时长
										</TableHead>
										<TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider">
											状态
										</TableHead>
										<TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider">
											得分
										</TableHead>
										<TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider">
											操作
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{records.map((r) => {
										const durMins = recordDurMins(r);
										return (
											<TableRow key={r.id}>
												<TableCell className="font-medium">
													{r.case_name}
												</TableCell>
												<TableCell>
													<Badge variant="secondary">问诊</Badge>
												</TableCell>
												<TableCell className="text-xs text-muted-foreground">
													{r.assignment_title ? (
														<span className="inline-flex items-center rounded bg-primary/10 px-1.5 py-px text-[11px] text-primary">作业</span>
													) : (
														<span className="text-muted-foreground/40">自由训练</span>
													)}
												</TableCell>
												<TableCell className="text-xs text-muted-foreground hidden sm:table-cell">
													{new Date(r.start_time).toLocaleString(
														"zh-CN",
													)}
												</TableCell>
												<TableCell
													className={cn(
														"hidden sm:table-cell",
														durMins != null
															? "text-muted-foreground"
															: "text-muted-foreground/50",
													)}
												>
													{durMins != null ? `${durMins} 分钟` : "进行中"}
												</TableCell>
												<TableCell>
													<Badge
														variant={
															r.status === "completed" ? "success" :
															r.status === "abandoned" ? "secondary" :
															"info"
														}
													>
														{r.status === "completed" ? "已完成" :
														 r.status === "abandoned" ? "已放弃" :
														 "进行中"}
													</Badge>
												</TableCell>
												<TableCell>
													{r.score_total != null ? (
														<span className="font-semibold text-primary">
															{r.score_total}分
														</span>
													) : r.scoring_status === "pending" ||
														r.scoring_status === "processing" ? (
														<Badge variant="warning">评分中...</Badge>
													) : r.scoring_status === "failed" ? (
														<span
															className="text-xs text-destructive"
															title={r.scoring_error ?? undefined}
														>
															评分失败
														</span>
													) : (
														<span className="text-muted-foreground/40">-</span>
													)}
												</TableCell>
												<TableCell>
													<div className="flex items-center gap-2">
														{r.status === "in_progress" && (
															<>
																<Button
																	variant="link"
																	size="xs"
																	onClick={() =>
																		navigate(`/training/${r.id}`)
																	}
																>
																	继续训练
																</Button>
																<Button
																	variant="link"
																	size="xs"
																	className="text-muted-foreground"
																	onClick={() => handleAbandonRecord(r)}
																>
																	放弃
																</Button>
															</>
														)}
														{(r.status === "completed" || r.status === "abandoned") && (
															<Button
																variant="link"
																size="xs"
																onClick={() =>
																	navigate(`/record/${r.id}`)
																}
															>
																{r.status === "abandoned" ? "查看" : "查看详情"}
															</Button>
														)}
														<Button
															variant="ghost"
															size="icon-xs"
															onClick={() => handleDeleteRecord(r)}
															className="text-destructive hover:text-destructive"
														>
															<Trash2 size={14} />
														</Button>
													</div>
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						</div>
					</div>
				)}
				<div className="rounded-xl border bg-card px-4 py-3">
					<Pagination
						total={total}
						offset={offset}
						limit={LIMIT}
						onChange={(newOffset) => setParam("offset", String(newOffset))}
					/>
				</div>
		</RecordSubPageLayout>
	);
}
