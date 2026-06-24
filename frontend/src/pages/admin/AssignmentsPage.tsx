import { useQueryClient } from "@tanstack/react-query";
import { Edit, Eye, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
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
import { Card } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import PageHeader from "@/components/ui/page-header";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useApiQuery } from "@/hooks/useApiQuery";
import { getApiErrorMessage } from "@/lib/error-utils";

function formatDateTime(iso: string) {
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

export default function AssignmentsPage() {
	const toast = useToast();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const [modalOpen, setModalOpen] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const { confirm } = useConfirm();

	const emptyForm = useMemo(
		() => ({
			title: "",
			desc: "",
			practiceId: 0,
			classId: 0,
			startTime: "",
			endTime: "",
		}),
		[],
	);
	const [form, setForm] = useState(emptyForm);
	const resetForm = () => setForm(emptyForm);
	const updateForm = (patch: Partial<typeof emptyForm>) =>
		setForm((f) => ({ ...f, ...patch }));

	const { data: listData, isLoading } = useApiQuery({
		queryKey: queryKeys.assignments.all,
		queryFn: () => getAssignments({ limit: 100 }),
		staleTime: 2 * 60_000,
	});
	const { data: practicesData } = useApiQuery({
		queryKey: queryKeys.practices.all,
		queryFn: () => getPractices(),
		staleTime: 5 * 60_000,
	});
	const { data: classesData } = useApiQuery({
		queryKey: queryKeys.grades.classes(),
		queryFn: () => getClasses({}),
		staleTime: 5 * 60_000,
	});

	const assignments = listData?.items ?? [];
	const practices = practicesData?.items ?? [];
	const classes = classesData ?? [];

	const openCreate = () => {
		setEditingId(null);
		resetForm();
		setModalOpen(true);
	};

	const openEdit = async (id: string) => {
		try {
			const res = await fetchAssignment(id);
			const d = res.data;
			const toLocalDatetime = (iso: string) => {
				const date = new Date(iso);
				const pad = (n: number) => String(n).padStart(2, "0");
				return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
			};
			setEditingId(id);
			setForm({
				title: d.title,
				desc: d.description || "",
				practiceId: d.practice_id,
				classId: d.class_id,
				startTime: toLocalDatetime(d.start_time),
				endTime: toLocalDatetime(d.end_time),
			});
			setModalOpen(true);
		} catch (e: unknown) {
			toast.error(getApiErrorMessage(e, "加载失败"));
		}
	};

	const handleSave = async () => {
		const { title, desc, practiceId, classId, startTime, endTime } = form;
		if (!title.trim() || !practiceId || !classId || !startTime || !endTime) {
			toast.warning("请填写完整信息");
			return;
		}
		const payload = {
			title: title.trim(),
			description: desc.trim() || null,
			practice_id: practiceId,
			class_id: classId,
			start_time: new Date(startTime).toISOString(),
			end_time: new Date(endTime).toISOString(),
		};
		setSaving(true);
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
			toast.error(getApiErrorMessage(e, "操作失败"));
		} finally {
			setSaving(false);
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
			toast.error(getApiErrorMessage(e, "删除失败"));
		}
	};

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

			{isLoading ? (
				<LoadingSkeleton />
			) : assignments.length === 0 ? (
				<EmptyState
					icon={Plus}
					title="暂无练习发布"
					description="点击上方按钮创建第一次练习发布"
				/>
			) : (
				<Card className="overflow-hidden">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>标题</TableHead>
								<TableHead>练习</TableHead>
								<TableHead>班级</TableHead>
								<TableHead>时间窗口</TableHead>
								<TableHead>完成</TableHead>
								<TableHead>状态</TableHead>
								<TableHead>操作</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{assignments.map((a: any) => (
								<TableRow key={a.id}>
									<TableCell className="font-medium max-w-[160px] truncate">
										{a.title}
									</TableCell>
									<TableCell className="text-sm text-muted-foreground">
										{a.practice_name}
									</TableCell>
									<TableCell className="text-sm">{a.class_name}</TableCell>
									<TableCell className="text-xs text-muted-foreground">
										{formatDateTime(a.start_time)} ~{" "}
										{formatDateTime(a.end_time)}
									</TableCell>
									<TableCell className="text-sm">
										{a.student_count > 0
											? `${a.completed_count}/${a.student_count}`
											: "-"}
									</TableCell>
									<TableCell>{statusBadge(a)}</TableCell>
									<TableCell>
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
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</Card>
			)}

			<Dialog
				open={modalOpen}
				onOpenChange={(o) => !o && setModalOpen(false)}
			>
				<DialogContent
					title={editingId ? "编辑练习发布" : "创建练习发布"}
					maxWidth={560}
				>
				<div className="flex flex-col gap-4">
					<div>
						<label className="text-sm font-medium">标题</label>
						<Input
							value={form.title}
							onChange={(e) => updateForm({ title: e.target.value })}
							placeholder="练习标题"
						/>
					</div>
					<div>
						<label className="text-sm font-medium">说明（可选）</label>
						<Input
							value={form.desc}
							onChange={(e) => updateForm({ desc: e.target.value })}
							placeholder="补充说明"
						/>
					</div>
					<div>
						<label className="text-sm font-medium">练习</label>
						<select
							className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
							value={form.practiceId || ""}
							onChange={(e) =>
								updateForm({ practiceId: Number(e.target.value) })
							}
						>
							<option value="">选择练习...</option>
							{practices.map((p: any) => (
								<option key={p.id} value={p.id}>
									{p.name}
									{p.case?.name ? ` (${p.case.name})` : ""}
								</option>
							))}
						</select>
					</div>
					<div>
						<label className="text-sm font-medium">班级</label>
						<select
							className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
							value={form.classId || ""}
							onChange={(e) => updateForm({ classId: Number(e.target.value) })}
						>
							<option value="">选择班级...</option>
							{classes.map((c: any) => (
								<option key={c.id} value={c.id}>
									{c.name}
								</option>
							))}
						</select>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<div>
							<label className="text-sm font-medium">开始时间</label>
							<Input
								type="datetime-local"
								value={form.startTime}
								onChange={(e) => updateForm({ startTime: e.target.value })}
							/>
						</div>
						<div>
							<label className="text-sm font-medium">截止时间</label>
							<Input
								type="datetime-local"
								value={form.endTime}
								onChange={(e) => updateForm({ endTime: e.target.value })}
							/>
						</div>
					</div>
					<div className="flex justify-end gap-2 pt-2">
						<Button variant="outline" onClick={() => setModalOpen(false)}>
							取消
						</Button>
						<Button onClick={handleSave} disabled={saving}>
							{editingId ? "保存" : "发布"}
						</Button>
					</div>
				</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
