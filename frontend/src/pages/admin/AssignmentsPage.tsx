import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit, Eye, Plus, Search, Trash2, XCircle } from "lucide-react";
import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
	createAssignment,
	deleteAssignment,
	getAssignment as fetchAssignment,
	getAssignments,
	updateAssignment,
} from "@/api/assignments";
import { getManageCases } from "@/api/cases";
import { getClasses } from "@/api/grades-classes";
import { queryKeys } from "@/api/query-keys";
import ClassFilter from "@/components/admin/ClassFilter";
import CaseSelector from "@/components/admin/cases/CaseSelector";
import { useToast } from "@/components/Toast";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import type { DataTableColumn } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import PageHeader from "@/components/ui/page-header";
import ResponsiveTable from "@/components/ui/responsive-table";
import { ALL_CAPABILITIES } from "@/engine/capabilities.gen";
import { type AssignmentValues, assignmentSchema } from "@/schemas/assignment";
import { fromDatetimeLocal, toDatetimeLocal } from "@/utils/date";

interface AssignmentRow {
	id: string;
	title: string;
	case_name?: string;
	class_name?: string;
	teacher_name?: string;
	start_time: string;
	end_time: string;
	student_count?: number;
	completed_count?: number;
	is_closed?: boolean;
}

interface CaseOption {
	id: number;
	name: string;
	training_type?: string;
	difficulty?: number;
	capabilities?: Record<string, boolean>;
}

interface ClassOption {
	id: number;
	name: string;
}

function formatWindow(iso: string) {
	const d = new Date(iso);
	const m = (d.getMonth() + 1).toString().padStart(2, "0");
	const day = d.getDate().toString().padStart(2, "0");
	const h = d.getHours().toString().padStart(2, "0");
	const min = d.getMinutes().toString().padStart(2, "0");
	return `${m}/${day} ${h}:${min}`;
}

function statusBadge(item: { start_time: string; end_time: string }) {
	const now = Date.now();
	if (now < new Date(item.start_time).getTime())
		return <Badge variant="secondary">未开始</Badge>;
	if (now > new Date(item.end_time).getTime())
		return <Badge variant="outline">已结束</Badge>;
	return (
		<span className="inline-flex items-center rounded-full bg-success px-2 py-0.5 text-xs font-medium text-success-foreground">
			进行中
		</span>
	);
}

const DEFAULT_VALUES: AssignmentValues = {
	title: "",
	desc: "",
	caseId: 0,
	classId: 0,
	startTime: "",
	endTime: "",
	maxAttempts: null as number | null,
};

export default function AssignmentsPage({ embedded = false }: { embedded?: boolean }) {
	const toast = useToast();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const [searchParams, setSearchParams] = useSearchParams();
	const classId = searchParams.get("class_id") || "";
	const statusFilter = searchParams.get("status") || "";
	const [search, setSearch] = useState("");

	const updateParam = useCallback(
		(key: string, value: string) => {
			setSearchParams((prev) => {
				const next = new URLSearchParams(prev);
				if (value) next.set(key, value);
				else next.delete(key);
				return next;
			});
		},
		[setSearchParams],
	);

	const [modalOpen, setModalOpen] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const { confirm } = useConfirm();

	const form = useForm<AssignmentValues>({
		resolver: zodResolver(assignmentSchema),
		defaultValues: DEFAULT_VALUES,
	});

	const { data: listData, isLoading } = useQuery({
		queryKey: queryKeys.assignments.list({ class_id: classId, status: statusFilter }),
		queryFn: () => {
			const params: Record<string, unknown> = { limit: 100 };
			if (classId) params.class_id = Number(classId);
			if (statusFilter) params.status = statusFilter;
			return getAssignments(params).then((r) => r.data);
		},
		staleTime: 2 * 60_000,
	});
	const { data: casesData, isLoading: casesLoading } = useQuery({
		queryKey: queryKeys.cases.managed.all,
		queryFn: () => getManageCases({ limit: 100 }).then((r) => r.data),
		staleTime: 5 * 60_000,
	});
	const { data: classesData } = useQuery({
		queryKey: queryKeys.grades.classes(),
		queryFn: () => getClasses({}).then((r) => r.data),
		staleTime: 5 * 60_000,
	});

	const assignments = (listData?.items ?? []) as unknown as AssignmentRow[];
	const cases = (casesData?.items ?? []) as unknown as CaseOption[];
	const classes = (classesData ?? []) as unknown as ClassOption[];

	const filteredAssignments = search
		? assignments.filter((a) => a.title?.toLowerCase().includes(search.toLowerCase()))
		: assignments;

	const openCreate = () => {
		setEditingId(null);
		form.reset(DEFAULT_VALUES);
		setModalOpen(true);
	};

	const openEdit = async (id: string) => {
		try {
			const res = await fetchAssignment(id);
			const d = res.data;
			setEditingId(id);
			form.reset({
				title: d.title,
				desc: d.description || "",
				caseId: d.case_id,
				classId: d.class_id,
				startTime: toDatetimeLocal(d.start_time),
				endTime: toDatetimeLocal(d.end_time),
				maxAttempts: (d as any).max_attempts ?? null,
			});
			setModalOpen(true);
		} catch (e: unknown) {
			toast.apiError(e, "加载失败");
		}
	};

	const onSubmit = async (values: AssignmentValues) => {
		const payload: Record<string, unknown> = {
			title: values.title.trim(),
			description: values.desc.trim() || null,
			case_id: values.caseId,
			class_id: values.classId,
			start_time: fromDatetimeLocal(values.startTime) ?? "",
			end_time: fromDatetimeLocal(values.endTime) ?? "",
		};
		if (values.maxAttempts != null) {
			payload.max_attempts = values.maxAttempts;
		}
		try {
			if (editingId) {
				await updateAssignment(editingId, payload as any);
				toast.success("更新成功");
			} else {
				await createAssignment(payload as any);
				toast.success("创建成功");
			}
			queryClient.invalidateQueries({ queryKey: queryKeys.assignments.all });
			setModalOpen(false);
		} catch (e: unknown) {
			toast.apiError(e, "操作失败");
		}
	};

	const handleDelete = async (id: string) => {
		const ok = await confirm({
			title: "确认删除",
			message: "确定要删除这个作业吗？此操作不可逆。",
		});
		if (!ok) return;
		try {
			await deleteAssignment(id);
			toast.success("已删除");
			queryClient.invalidateQueries({ queryKey: queryKeys.assignments.all });
		} catch (e: unknown) {
			toast.apiError(e, "删除失败");
		}
	};

	const handleToggleClose = async (a: AssignmentRow) => {
		const isClosed = Boolean(a.is_closed);
		const ok = await confirm({
			title: isClosed ? "重新开放作业" : "关闭作业",
			message: isClosed
				? "重新开放后学生可继续练习，确定？"
				: "关闭后学生无法开始新练习，已在进行的仍可完成，确定？",
		});
		if (!ok) return;
		try {
			await updateAssignment(a.id, { is_closed: !isClosed } as any);
			toast.success(isClosed ? "已重新开放" : "已关闭");
			queryClient.invalidateQueries({ queryKey: queryKeys.assignments.all });
		} catch (e: unknown) {
			toast.apiError(e, "操作失败");
		}
	};

	const columns: DataTableColumn<AssignmentRow>[] = [
		{
			key: "title",
			header: "标题",
			cellClassName: "font-medium max-w-[160px] truncate",
		},
		{
			key: "case_name",
			header: "病例",
			cellClassName: "text-sm text-muted-foreground",
		},
		{ key: "class_name", header: "班级", cellClassName: "text-sm" },
		{ key: "teacher_name", header: "教师", cellClassName: "text-sm text-muted-foreground" },
		{
			key: "window",
			header: "时间窗口",
			cellClassName: "text-xs text-muted-foreground",
			render: (a) => `${formatWindow(a.start_time)} ~ ${formatWindow(a.end_time)}`,
		},
		{
			key: "completed",
			header: "完成",
			cellClassName: "text-sm",
			render: (a) =>
				(a.student_count ?? 0) > 0
					? `${a.completed_count}/${a.student_count}`
					: "-",
		},
		{
			key: "status",
			header: "状态",
			render: (a) => (
				<div className="flex items-center gap-1.5">
					{statusBadge(a)}
					{a.is_closed && (
						<span className="inline-flex items-center rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">已关闭</span>
					)}
				</div>
			),
		},
		{
			key: "actions",
			header: "操作",
			render: (a) => (
				<div className="flex gap-0.5">
					<Button
						variant="ghost"
						size="icon"
						onClick={() => navigate(`/admin/assignments/${a.id}`)}
						title="详情"
					>
						<Eye size={15} />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						onClick={() => openEdit(a.id)}
						title="编辑"
					>
						<Edit size={15} />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						onClick={() => handleToggleClose(a)}
						title={a.is_closed ? "重新开放" : "关闭"}
					>
						<XCircle size={15} />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						onClick={() => handleDelete(a.id)}
						title="删除"
					>
						<Trash2 size={15} className="text-destructive" />
					</Button>
				</div>
			),
		},
	];

	return (
		<div className={embedded ? "" : "space-y-6"}>
			{embedded ? (
				<div className="flex justify-end gap-2 mb-4">
					<Button onClick={openCreate}>
						<Plus size={16} className="mr-1" />
						创建作业
					</Button>
				</div>
			) : (
			<PageHeader
				title="作业管理"
				subtitle="按班级布置练习，选择病例和功能配置"
				actions={
					<Button onClick={openCreate}>
						<Plus size={16} className="mr-1" />
						创建作业
					</Button>
				}
			/>
			)}
			<div className="flex flex-wrap items-center gap-3 mb-4">
				<div className="relative flex-1 max-w-xs">
					<Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
					<input
						type="text"
						placeholder="搜索标题..."
						aria-label="搜索作业标题"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="w-full pl-8 pr-3 py-1.5 border border-border rounded-lg text-sm bg-card"
					/>
				</div>
				<ClassFilter
					classId={classId ? Number(classId) : undefined}
					onChange={(params) => {
						updateParam("class_id", params.class_id ? String(params.class_id) : "");
					}}
				/>
				<select
					value={statusFilter}
					onChange={(e) => updateParam("status", e.target.value)}
					className="py-1.5 px-2.5 border border-border rounded-lg text-sm bg-card"
				>
					<option value="">全部状态</option>
					<option value="active">进行中</option>
					<option value="ended">已结束</option>
				</select>
			</div>

		<ResponsiveTable<AssignmentRow>
			columns={columns}
			rows={filteredAssignments}
			rowKey={(a) => a.id}
			loading={isLoading}
			emptyIcon={Plus}
			emptyTitle="暂无作业"
			emptyDescription="点击上方按钮创建第一次作业"
			renderCard={(a) => (
				<div className="rounded-lg border bg-card p-3 space-y-2">
					<div className="text-sm font-medium truncate">{a.title}</div>
					<div className="text-xs text-muted-foreground">{a.case_name} · {a.class_name}</div>
					<div className="flex items-center justify-between gap-2">
						<span className="text-xs text-muted-foreground">
							{a.completed_count ?? 0}/{a.student_count ?? 0} 完成
						</span>
						<div className="grid grid-cols-2 gap-1">
							<Button variant="outline" size="sm" onClick={() => navigate(`/admin/assignments/${a.id}`)}>详情</Button>
							<Button variant="outline" size="sm" onClick={() => openEdit(a.id)}>编辑</Button>
							<Button variant="outline" size="sm" onClick={() => handleToggleClose(a)}>{a.is_closed ? "开放" : "关闭"}</Button>
							<Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => handleDelete(a.id)}>删除</Button>
						</div>
					</div>
				</div>
			)}
		/>

			<Dialog open={modalOpen} onOpenChange={async (o) => {
				if (!o) {
					if (form.formState.isDirty) {
						const ok = await confirm({ title: "未保存的更改", message: "内容未保存，确定关闭？", danger: true });
						if (!ok) return;
					}
					setModalOpen(false);
				}
			}}>
				<DialogContent
					title={editingId ? "编辑作业" : "创建作业"}
					maxWidth={560}
				>
					<Form {...form}>
						<form
							onSubmit={form.handleSubmit(onSubmit)}
							className="flex flex-col gap-4"
						>
							<FormField
								control={form.control}
								name="title"
								render={({ field }) => (
									<FormItem>
										<FormLabel>标题</FormLabel>
										<FormControl>
											<Input placeholder="作业标题" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="desc"
								render={({ field }) => (
									<FormItem>
										<FormLabel>说明（可选）</FormLabel>
										<FormControl>
											<Input placeholder="补充说明" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="caseId"
								render={({ field }) => (
									<FormItem>
										<FormLabel>病例</FormLabel>
										<FormControl>
											<CaseSelector
												cases={cases}
												value={field.value || 0}
												onChange={(id) => field.onChange(id)}
												loading={casesLoading}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="classId"
								render={({ field }) => (
									<FormItem>
										<FormLabel>班级</FormLabel>
										<FormControl>
											<select
												className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
												name={field.name}
												onBlur={field.onBlur}
												value={field.value || ""}
												onChange={(e) => field.onChange(Number(e.target.value))}
											>
												<option value="">选择班级...</option>
												{classes.map((c) => (
													<option key={c.id} value={c.id}>
														{c.name}
													</option>
												))}
											</select>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<div className="grid grid-cols-2 gap-3">
								<FormField
									control={form.control}
									name="startTime"
									render={({ field }) => (
										<FormItem>
											<FormLabel>开始时间</FormLabel>
											<FormControl>
												<Input type="datetime-local" {...field} />
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="endTime"
									render={({ field }) => (
										<FormItem>
											<FormLabel>截止时间</FormLabel>
											<FormControl>
												<Input type="datetime-local" {...field} />
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>
							{(() => {
								const selectedId = form.watch("caseId");
								const selected = cases.find((c) => c.id === selectedId);
								const caps = selected?.capabilities;
								if (!caps) return null;
								const enabled = Object.entries(caps).filter(([, v]) => v);
								if (enabled.length === 0) return null;
								return (
									<div className="flex flex-wrap gap-1 -mt-2 mb-1">
										{enabled.map(([k]) => (
											<span
												key={k}
												className="inline-flex items-center rounded bg-primary/10 px-1.5 py-px text-[11px] text-primary"
											>
												{ALL_CAPABILITIES[k]?.label ?? k}
											</span>
										))}
									</div>
								);
							})()}
							<FormField
								control={form.control}
								name="maxAttempts"
								render={({ field }) => (
									<FormItem>
										<FormLabel>最大尝试次数</FormLabel>
										<FormControl>
											<Input
												type="number"
												min={0}
												placeholder="留空为1次，0为不限制"
												{...field}
												value={field.value ?? ""}
												onChange={(e) => {
													const v = e.target.value;
													field.onChange(v === "" ? null : Math.max(0, Number(v)));
												}}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									onClick={async () => { 
										if (form.formState.isDirty) {
											const ok = await confirm({ title: "未保存的更改", message: "内容未保存，确定关闭？", danger: true });
											if (!ok) return;
										}
										setModalOpen(false);
									}}
								>
									取消
								</Button>
								<Button onClick={form.handleSubmit(onSubmit)} disabled={form.formState.isSubmitting}>
									{form.formState.isSubmitting ? (editingId ? "保存中..." : "发布中...") : (editingId ? "保存" : "发布")}
								</Button>
							</DialogFooter>
						</form>
					</Form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
