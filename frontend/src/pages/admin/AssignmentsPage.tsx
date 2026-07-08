import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit, Eye, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import {
	createAssignment,
	deleteAssignment,
	getAssignment as fetchAssignment,
	getAssignments,
	updateAssignment,
} from "@/api/assignments";
import { getClasses } from "@/api/grades-classes";
import { getPractices } from "@/api/practices";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import DataTable, { type DataTableColumn } from "@/components/ui/data-table";
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
import { type AssignmentValues, assignmentSchema } from "@/schemas/assignment";
import { fromDatetimeLocal, toDatetimeLocal } from "@/utils/date";

interface AssignmentRow {
	id: string;
	title: string;
	practice_name?: string;
	class_name?: string;
	start_time: string;
	end_time: string;
	student_count?: number;
	completed_count?: number;
}

interface PracticeOption {
	id: number;
	name: string;
	case?: { name?: string };
}

interface ClassOption {
	id: number;
	name: string;
}

/** Compact list-window display (M/D H:M) — distinct from lib/date's full locale. */
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
	practiceId: 0,
	classId: 0,
	startTime: "",
	endTime: "",
};

export default function AssignmentsPage() {
	const toast = useToast();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const [modalOpen, setModalOpen] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const { confirm } = useConfirm();

	const form = useForm<AssignmentValues>({
		resolver: zodResolver(assignmentSchema),
		defaultValues: DEFAULT_VALUES,
	});

	const { data: listData, isLoading } = useQuery({
		queryKey: queryKeys.assignments.all,
		queryFn: () => getAssignments({ limit: 100 }).then((r) => r.data),
		staleTime: 2 * 60_000,
	});
	const { data: practicesData } = useQuery({
		queryKey: queryKeys.practices.all,
		queryFn: () => getPractices().then((r) => r.data),
		staleTime: 5 * 60_000,
	});
	const { data: classesData } = useQuery({
		queryKey: queryKeys.grades.classes(),
		queryFn: () => getClasses({}).then((r) => r.data),
		staleTime: 5 * 60_000,
	});

	const assignments = (listData?.items ?? []) as unknown as AssignmentRow[];
	const practices = (practicesData?.items ?? []) as unknown as PracticeOption[];
	const classes = (classesData ?? []) as unknown as ClassOption[];

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
				practiceId: d.practice_id,
				classId: d.class_id,
				startTime: toDatetimeLocal(d.start_time),
				endTime: toDatetimeLocal(d.end_time),
			});
			setModalOpen(true);
		} catch (e: unknown) {
			toast.apiError(e, "加载失败");
		}
	};

	const onSubmit = async (values: AssignmentValues) => {
		const payload = {
			title: values.title.trim(),
			description: values.desc.trim() || null,
			practice_id: values.practiceId,
			class_id: values.classId,
			start_time: fromDatetimeLocal(values.startTime) ?? "",
			end_time: fromDatetimeLocal(values.endTime) ?? "",
		};
		try {
			if (editingId) {
				await updateAssignment(editingId, payload);
				toast.success("更新成功");
			} else {
				await createAssignment(payload);
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
			message: "确定要删除这个练习发布吗？此操作不可逆。",
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

	const columns: DataTableColumn<AssignmentRow>[] = [
		{
			key: "title",
			header: "标题",
			cellClassName: "font-medium max-w-[160px] truncate",
		},
		{
			key: "practice_name",
			header: "练习",
			cellClassName: "text-sm text-muted-foreground",
		},
		{ key: "class_name", header: "班级", cellClassName: "text-sm" },
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
		{ key: "status", header: "状态", render: (a) => statusBadge(a) },
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
		<div className="space-y-6">
			<PageHeader
				title="练习发布"
				subtitle="按班级定时发布练习，控制插件特性，批量导出成绩"
				actions={
					<Button onClick={openCreate}>
						<Plus size={16} className="mr-1" />
						创建发布
					</Button>
				}
			/>

			<DataTable<AssignmentRow>
				columns={columns}
				rows={assignments}
				rowKey={(a) => a.id}
				loading={isLoading}
				emptyIcon={Plus}
				emptyTitle="暂无练习发布"
				emptyDescription="点击上方按钮创建第一次练习发布"
			/>

			<Dialog open={modalOpen} onOpenChange={(o) => !o && setModalOpen(false)}>
				<DialogContent
					title={editingId ? "编辑练习发布" : "创建练习发布"}
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
											<Input placeholder="练习标题" {...field} />
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
								name="practiceId"
								render={({ field }) => (
									<FormItem>
										<FormLabel>练习</FormLabel>
										<FormControl>
											<select
												className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
												name={field.name}
												onBlur={field.onBlur}
												value={field.value || ""}
												onChange={(e) => field.onChange(Number(e.target.value))}
											>
												<option value="">选择练习...</option>
												{practices.map((p) => (
													<option key={p.id} value={p.id}>
														{p.name}
														{p.case?.name ? ` (${p.case.name})` : ""}
													</option>
												))}
											</select>
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
							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									onClick={() => setModalOpen(false)}
								>
									取消
								</Button>
								<Button onClick={form.handleSubmit(onSubmit)} disabled={form.formState.isSubmitting}>
									{editingId ? "保存" : "发布"}
								</Button>
							</DialogFooter>
						</form>
					</Form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
