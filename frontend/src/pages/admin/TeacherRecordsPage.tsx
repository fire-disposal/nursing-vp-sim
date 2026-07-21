import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	ClipboardList,
	Loader2,
	RefreshCw,
	Trash2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { abandonRecord, deleteRecord, getCases, getRecords } from "@/api";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import ClassFilter from "@/components/admin/ClassFilter";
import { useToast } from "@/components/Toast";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import EmptyState from "@/components/ui/empty-state";
import PageHeader from "@/components/ui/page-header";
import Pagination from "@/components/ui/pagination";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import { cn } from "@/utils/cn";

type TrainingRecordBrief = components["schemas"]["TrainingRecordBrief"];

type SortField = "start_time" | "score_total" | "duration" | null;
type SortDir = "asc" | "desc";

const LIMIT = 50;

function durationMinutes(r: TrainingRecordBrief): number | null {
	if (!r.end_time) return null;
	return Math.round(
		(new Date(r.end_time).getTime() - new Date(r.start_time).getTime()) / 60000,
	);
}

export default function TeacherRecordsPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const navigate = useNavigate();
	const toast = useToast();
	const { confirm } = useConfirm();
	const queryClient = useQueryClient();

	const [sortField, setSortField] = useState<SortField>(null);
	const [sortDir, setSortDir] = useState<SortDir>("desc");

	const student_name = searchParams.get("student_name") || "";
	const case_id = searchParams.get("case_id") || "";
	const status = searchParams.get("status") || "";
	const training_type = searchParams.get("training_type") || "";
	const date_from = searchParams.get("date_from") || "";
	const date_to = searchParams.get("date_to") || "";
	const exclude_is_test = searchParams.get("exclude_is_test") !== "false";
	const class_id = searchParams.get("class_id") || "";
	const offset = parseInt(searchParams.get("offset") || "0", 10);

	const { searchInput, debouncedValue: debouncedStudent, handleSearchChange } =
		useDebouncedSearch(student_name, 300);

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

	const { data: casesData } = useQuery({
		queryKey: queryKeys.cases.lists(),
		queryFn: () => getCases({ limit: 100, offset: 0 }).then((r) => r.data),
		staleTime: 5 * 60_000,
	});
	const caseOptions = casesData?.items ?? [];

	const params = useMemo(() => {
		const p: Record<string, unknown> = { offset, limit: LIMIT };
		if (debouncedStudent) p.student_name = debouncedStudent;
		if (case_id) p.case_id = Number(case_id);
		if (status) p.status = status;
		if (training_type) p.training_type = training_type;
		if (date_from) p.date_from = date_from;
		if (date_to) p.date_to = date_to;
		if (class_id) p.class_id = Number(class_id);
		if (exclude_is_test) p.exclude_is_test = true;
		return p;
	}, [offset, debouncedStudent, case_id, status, training_type, date_from, date_to, class_id, exclude_is_test]);

	const { data, isLoading, isError, error, refetch } = useQuery({
		queryKey: queryKeys.training.records(params),
		queryFn: () => getRecords(params).then((r) => r.data),
		staleTime: 2 * 60_000,
	});

	const records = data?.items ?? [];
	const total = data?.total ?? 0;

	const sortedRecords = useMemo(() => {
		if (!sortField) return records;
		const sorted = [...records].sort((a, b) => {
			let va: number = 0;
			let vb: number = 0;
			if (sortField === "start_time") {
				va = new Date(a.start_time).getTime();
				vb = new Date(b.start_time).getTime();
			} else if (sortField === "score_total") {
				va = a.score_total ?? -Infinity;
				vb = b.score_total ?? -Infinity;
			} else if (sortField === "duration") {
				va = durationMinutes(a) ?? -Infinity;
				vb = durationMinutes(b) ?? -Infinity;
			}
			return sortDir === "asc" ? va - vb : vb - va;
		});
		return sorted;
	}, [records, sortField, sortDir]);

	const handleSort = (field: SortField) => {
		if (sortField === field) {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		} else {
			setSortField(field);
			setSortDir("desc");
		}
	};

	const sortIcon = (field: SortField) => {
		if (sortField !== field)
			return <ArrowUpDown size={12} className="ml-1 inline text-muted-foreground/50" />;
		return sortDir === "asc" ? (
			<ArrowUp size={12} className="ml-1 inline" />
		) : (
			<ArrowDown size={12} className="ml-1 inline" />
		);
	};

	const stats = useMemo(() => {
		const completed = records.filter((r) => r.status === "completed");
		const scored = completed.filter(
			(r) => r.scoring_status === "completed" && r.score_total != null,
		);
		const avgScore =
			scored.length > 0
				? scored.reduce((sum, r) => sum + (r.score_total ?? 0), 0) / scored.length
				: null;
		const scoringRate =
			total > 0
				? Math.round((scored.length / total) * 100)
				: 0;
		return {
			completed: completed.length,
			scored: scored.length,
			avgScore,
			scoringRate,
		};
	}, [records, total]);

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

	const handleClearFilters = () => {
		setSearchParams({}, { replace: true });
	};

	const handleClassFilterChange = useCallback(
		(params: { grade_id: number | null; class_id: number | null }) => {
			setParam("class_id", params.class_id != null ? String(params.class_id) : "");
		},
		[setParam],
	);

	return (
		<>
			<PageHeader
				title="训练记录管理"
				subtitle="查看和管理所有学生的训练记录"
				icon={ClipboardList}
			/>

			<div className="space-y-4">
				<div className="rounded-xl border bg-card p-4 sm:p-5">
					<div className="flex flex-col gap-3">
						<div className="flex flex-row flex-wrap items-end gap-3">
							<div className="min-w-[200px]">
								<label className="block text-xs font-medium text-muted-foreground mb-1.5">
									班级
								</label>
								<ClassFilter
									classId={class_id ? Number(class_id) : undefined}
									onChange={handleClassFilterChange}
								/>
							</div>
							<div className="flex-1 min-w-[160px]">
								<label className="block text-xs font-medium text-muted-foreground mb-1.5">
									学生搜索
								</label>
								<input
									type="text"
									placeholder="搜索学生姓名或学号..."
									value={searchInput}
									onChange={(e) => handleSearchChange(e.target.value)}
									className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus-ring"
								/>
							</div>
							<div className="min-w-[140px]">
								<label className="block text-xs font-medium text-muted-foreground mb-1.5">
									病例
								</label>
								<select
									value={case_id}
									onChange={(e) => setParam("case_id", e.target.value)}
									className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus-ring"
								>
									<option value="">全部病例</option>
									{caseOptions.map((c) => (
										<option key={c.id} value={c.id}>
											{c.name}
										</option>
									))}
								</select>
							</div>
							<div className="min-w-[120px]">
								<label className="block text-xs font-medium text-muted-foreground mb-1.5">
									状态
								</label>
								<select
									value={status}
									onChange={(e) => setParam("status", e.target.value)}
									className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus-ring"
								>
									<option value="">全部</option>
									<option value="in_progress">进行中</option>
									<option value="completed">已完成</option>
									<option value="abandoned">已放弃</option>
								</select>
							</div>
							<div className="min-w-[120px]">
								<label className="block text-xs font-medium text-muted-foreground mb-1.5">
									类型
								</label>
								<select
									value={training_type}
									onChange={(e) => setParam("training_type", e.target.value)}
									className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus-ring"
								>
									<option value="">全部</option>
									<option value="history_taking">问诊</option>
									<option value="triage">分诊</option>
								</select>
							</div>
							<div className="min-w-[140px]">
								<label className="block text-xs font-medium text-muted-foreground mb-1.5">
									开始日期(起)
								</label>
								<input
									type="date"
									value={date_from}
									onChange={(e) => setParam("date_from", e.target.value)}
									className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus-ring"
								/>
							</div>
							<div className="min-w-[140px]">
								<label className="block text-xs font-medium text-muted-foreground mb-1.5">
									开始日期(止)
								</label>
								<input
									type="date"
									value={date_to}
									onChange={(e) => setParam("date_to", e.target.value)}
									className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus-ring"
								/>
							</div>
							<div className="flex items-end gap-2">
								<label className="flex items-center gap-1.5 text-sm h-9">
									<input
										type="checkbox"
										checked={exclude_is_test}
										onChange={(e) =>
											setParam("exclude_is_test", e.target.checked ? "true" : "false")
										}
										className="size-4 rounded border-input accent-primary"
									/>
									<span className="text-xs text-muted-foreground">排除试跑</span>
								</label>
								<Button variant="outline" size="default" onClick={handleClearFilters}>
									清除过滤
								</Button>
							</div>
						</div>
					</div>
				</div>

				{/* Stats bar */}
				<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
					<div className="rounded-xl border bg-card p-4 text-center">
						<div className="text-2xl font-bold tabular-nums">{total}</div>
						<div className="text-xs text-muted-foreground mt-1">筛选结果</div>
					</div>
					<div className="rounded-xl border bg-card p-4 text-center">
						<div className="text-2xl font-bold tabular-nums">{stats.completed}</div>
						<div className="text-xs text-muted-foreground mt-1">已完成</div>
					</div>
					<div className="rounded-xl border bg-card p-4 text-center">
						<div className="text-2xl font-bold tabular-nums">
							{stats.avgScore != null ? `${stats.avgScore.toFixed(1)}` : "-"}
						</div>
						<div className="text-xs text-muted-foreground mt-1">平均分</div>
					</div>
					<div className="rounded-xl border bg-card p-4 text-center">
						<div className="text-2xl font-bold tabular-nums">{stats.scoringRate}%</div>
						<div className="text-xs text-muted-foreground mt-1">评分完成率</div>
					</div>
				</div>

				{isLoading ? (
					<div className="flex flex-col items-center justify-center py-20 gap-3">
						<Loader2 size={36} className="animate-spin text-muted-foreground" />
						<span className="text-sm text-muted-foreground">加载中...</span>
					</div>
				) : isError ? (
					<div className="flex flex-col items-center justify-center py-20 gap-3 rounded-xl border bg-card">
						<ClipboardList size={40} className="text-muted-foreground/40" />
						<p className="text-sm text-destructive">
							{(error as { response?: { data?: { detail?: string } } })
								?.response?.data?.detail || "加载记录失败"}
						</p>
						<Button variant="outline" size="sm" onClick={() => refetch()}>
							<RefreshCw size={14} />
							重试
						</Button>
					</div>
				) : sortedRecords.length === 0 ? (
					<div className="rounded-xl border bg-card">
						<EmptyState icon={ClipboardList} title="暂无训练记录" description="当前筛选条件下没有找到训练记录" />
					</div>
				) : (
					<div className="rounded-xl border bg-card overflow-hidden">
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow className="bg-muted/50">
										<TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider">
											学生
										</TableHead>
										<TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider">
											学号
										</TableHead>
										<TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider">
											病例
										</TableHead>
										<TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider">
											类型
										</TableHead>
										<TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider">
											来源
										</TableHead>
										<TableHead
											className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider cursor-pointer select-none"
											onClick={() => handleSort("start_time")}
										>
											开始时间{sortIcon("start_time")}
										</TableHead>
										<TableHead
											className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider cursor-pointer select-none hidden sm:table-cell"
											onClick={() => handleSort("duration")}
										>
											时长{sortIcon("duration")}
										</TableHead>
										<TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider">
											状态
										</TableHead>
										<TableHead
											className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider cursor-pointer select-none"
											onClick={() => handleSort("score_total")}
										>
											得分{sortIcon("score_total")}
										</TableHead>
										<TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider">
											评分状态
										</TableHead>
										<TableHead className="sticky top-0 z-10 bg-muted/50 font-semibold text-xs uppercase tracking-wider">
											操作
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{sortedRecords.map((r) => {
										const durMins = durationMinutes(r);
										return (
											<TableRow key={r.id}>
												<TableCell>
													{r.user_display_name}
												</TableCell>
												<TableCell className="text-muted-foreground">
													{r.user_student_id ?? ""}
												</TableCell>
												<TableCell className="font-medium">
													{r.case_name}
												</TableCell>
												<TableCell>
													{r.training_type === "triage" ? (
														<Badge variant="info">分诊</Badge>
													) : (
														<Badge variant="secondary">问诊</Badge>
													)}
												</TableCell>
												<TableCell className="text-xs text-muted-foreground">
													{(r as any).assignment_title ? (
														<span className="inline-flex items-center rounded bg-primary/10 px-1.5 py-px text-[11px] text-primary">作业</span>
													) : (
														<span className="text-muted-foreground/40">自由训练</span>
													)}
												</TableCell>
												<TableCell className="text-xs text-muted-foreground">
													{new Date(r.start_time).toLocaleString("zh-CN")}
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
													{r.scoring_status === "completed" ? (
														<Badge variant="success">已完成</Badge>
													) : r.scoring_status === "pending" ||
														r.scoring_status === "processing" ? (
														<Badge variant="warning">评分中</Badge>
													) : r.scoring_status === "failed" ? (
														<Badge variant="destructive">失败</Badge>
													) : (
														<span className="text-muted-foreground/40">-</span>
													)}
												</TableCell>
												<TableCell>
													<div className="flex items-center gap-2">
														<Button
															variant="link"
															size="xs"
															onClick={() =>
																navigate(`/record/${r.id}`)
															}
														>
															查看详情
														</Button>
														{r.status === "in_progress" && (
															<Button
																variant="link"
																size="xs"
																className="text-muted-foreground"
																onClick={() => handleAbandonRecord(r)}
															>
																放弃
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
			</div>
		</>
	);
}
