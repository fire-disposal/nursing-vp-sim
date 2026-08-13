import { zodResolver } from "@hookform/resolvers/zod";
import { Badge, Box, Group, Select, SimpleGrid, Stack, Text } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconCircleX, IconEdit, IconEye, IconPlus, IconTrash } from "@tabler/icons-react";
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
import type { components } from "@/api/api-types.gen";
import { getClasses } from "@/api/grades-classes";
import { queryKeys } from "@/api/query-keys";
import ClassFilter from "@/components/admin/ClassFilter";
import CaseSelector from "@/components/admin/cases/CaseSelector";
import { useToast } from "@/components/Toast";
import Button from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Switch } from "@/components/ui/switch";
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
import { SearchInput } from "@/components/ui/search-input";
import { ALL_CAPABILITIES } from "@/engine/capabilities.gen";
import { type AssignmentValues, assignmentSchema } from "@/schemas/assignment";
import { fromDatetimeLocal, toDatetimeLocal } from "@/utils/date";

type Schemas = components["schemas"];

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
	return <Badge variant="success">进行中</Badge>;
}

const DEFAULT_VALUES: AssignmentValues = {
	title: "",
	desc: "",
	caseId: 0,
	classId: 0,
	startTime: "",
	endTime: "",
	maxAttempts: null as number | null,
	hideCaseInfo: false,
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
				maxAttempts: d.max_attempts ?? null,
				hideCaseInfo: d.behavior?.hide_case_info === true,
			});
			setModalOpen(true);
		} catch (e: unknown) {
			toast.apiError(e, "加载失败");
		}
	};

	const onSubmit = async (values: AssignmentValues) => {
		const payload: Schemas["AssignmentCreateRequest"] = {
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
		payload.behavior = { hide_case_info: values.hideCaseInfo };
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
			await updateAssignment(a.id, { is_closed: !isClosed });
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
			render: (a) => <Text fw={500} truncate maw={160}>{a.title}</Text>,
		},
		{
			key: "case_name",
			header: "病例",
			render: (a) => <Text size="sm" c="dimmed">{a.case_name}</Text>,
		},
		{
			key: "class_name",
			header: "班级",
			render: (a) => <Text size="sm">{a.class_name}</Text>,
		},
		{
			key: "teacher_name",
			header: "教师",
			render: (a) => <Text size="sm" c="dimmed">{a.teacher_name}</Text>,
		},
		{
			key: "window",
			header: "时间窗口",
			render: (a) => (
				<Text size="xs" c="dimmed">{formatWindow(a.start_time)} ~ {formatWindow(a.end_time)}</Text>
			),
		},
		{
			key: "completed",
			header: "完成",
			render: (a) =>
				(a.student_count ?? 0) > 0
					? `${a.completed_count}/${a.student_count}`
					: "-",
		},
		{
			key: "status",
			header: "状态",
			render: (a) => (
				<Group gap={6} wrap="nowrap">
					{statusBadge(a)}
					{a.is_closed && (
						<Badge variant="secondary" size="xs">已关闭</Badge>
					)}
				</Group>
			),
		},
		{
			key: "actions",
			header: "操作",
			render: (a) => (
				<Group gap={2} wrap="nowrap">
					<Button
						variant="ghost"
						size="icon"
						onClick={() => navigate(`/admin/assignments/${a.id}`)}
						title="详情"
					>
						<IconEye size={15} />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						onClick={() => openEdit(a.id)}
						title="编辑"
					>
						<IconEdit size={15} />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						onClick={() => handleToggleClose(a)}
						title={a.is_closed ? "重新开放" : "关闭"}
					>
						<IconCircleX size={15} />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						color="red"
						onClick={() => handleDelete(a.id)}
						title="删除"
					>
						<IconTrash size={15} />
					</Button>
				</Group>
			),
		},
	];

	return (
		<Stack gap={embedded ? 0 : "xl"}>
			{embedded ? (
				<Group justify="flex-end" gap={8} mb="md">
					<Button onClick={openCreate} leftSection={<IconPlus size={16} />}>
						创建作业
					</Button>
				</Group>
			) : (
				<PageHeader
					title="作业管理"
					subtitle="按班级布置练习，选择病例和功能配置"
					actions={
						<Button onClick={openCreate} leftSection={<IconPlus size={16} />}>
							创建作业
						</Button>
					}
				/>
			)}
			<Group gap={12} align="center" wrap="wrap" mb="md">
				<Box maw={320} style={{ flex: 1 }}>
					<SearchInput
						value={search}
						onChange={setSearch}
						placeholder="搜索标题..."
					/>
				</Box>
				<ClassFilter
					classId={classId ? Number(classId) : undefined}
					onChange={(params) => {
						updateParam("class_id", params.class_id ? String(params.class_id) : "");
					}}
				/>
				<Select
					value={statusFilter || null}
					onChange={(v) => updateParam("status", v ?? "")}
					data={[
						{ value: "", label: "全部状态" },
						{ value: "active", label: "进行中" },
						{ value: "ended", label: "已结束" },
					]}
					w={140}
				/>
			</Group>

			<ResponsiveTable<AssignmentRow>
				columns={columns}
				rows={filteredAssignments}
				rowKey={(a) => a.id}
				loading={isLoading}
				emptyIcon={IconPlus}
				emptyTitle="暂无作业"
				emptyDescription="点击上方按钮创建第一次作业"
				renderCard={(a) => (
					<Box
						style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 8, padding: 12 }}
					>
						<Stack gap={8}>
							<Group justify="space-between" align="flex-start" gap={8} wrap="nowrap">
								<Text size="sm" fw={500} truncate style={{ flex: 1 }}>{a.title}</Text>
								{statusBadge(a)}
							</Group>
							<Text size="xs" c="dimmed">{a.case_name} · {a.class_name}</Text>
							<Text size="xs" c="dimmed">
								{formatWindow(a.start_time)} ~ {formatWindow(a.end_time)}
							</Text>
							<Group justify="space-between" align="center" gap={8} wrap="wrap">
								<Text size="xs" c="dimmed">
									{a.completed_count ?? 0}/{a.student_count ?? 0} 完成
								</Text>
								<SimpleGrid cols={2} spacing={4}>
									<Button variant="outline" size="sm" onClick={() => navigate(`/admin/assignments/${a.id}`)}>详情</Button>
									<Button variant="outline" size="sm" onClick={() => openEdit(a.id)}>编辑</Button>
									<Button variant="outline" size="sm" onClick={() => handleToggleClose(a)}>{a.is_closed ? "开放" : "关闭"}</Button>
									<Button variant="outline" size="sm" color="red" onClick={() => handleDelete(a.id)}>删除</Button>
								</SimpleGrid>
							</Group>
						</Stack>
					</Box>
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
						<form onSubmit={form.handleSubmit(onSubmit)}>
							<Stack gap="md">
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
												<Select
													value={field.value ? String(field.value) : null}
													onChange={(v) => field.onChange(v ? Number(v) : 0)}
													data={[
														{ value: "", label: "选择班级..." },
														...classes.map((c) => ({
															value: String(c.id),
															label: c.name,
														})),
													]}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<SimpleGrid cols={2} spacing="sm">
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
								</SimpleGrid>
								{(() => {
									const selectedId = form.watch("caseId");
									const selected = cases.find((c) => c.id === selectedId);
									const caps = selected?.capabilities;
									if (!caps) return null;
									const enabled = Object.entries(caps).filter(([, v]) => v);
									if (enabled.length === 0) return null;
									return (
										<Group gap={4} wrap="wrap" mt={-8} mb={4}>
											{enabled.map(([k]) => (
												<Badge key={k} variant="secondary" color="teal" size="xs">
													{ALL_CAPABILITIES[k]?.label ?? k}
												</Badge>
											))}
										</Group>
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
								<FormField
									control={form.control}
									name="hideCaseInfo"
									render={({ field }) => (
										<FormItem>
											<Group
												justify="space-between"
												align="center"
												wrap="nowrap"
												p="sm"
												style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 8 }}
											>
												<div>
													<FormLabel>隐藏病例信息</FormLabel>
													<Text size="xs" c="dimmed">训练中不显示病例标题/患者信息，结束后揭示（病例固定，不做随机抽取）</Text>
												</div>
												<FormControl>
													<Switch checked={field.value} onCheckedChange={field.onChange} />
												</FormControl>
											</Group>
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
							</Stack>
						</form>
					</Form>
				</DialogContent>
			</Dialog>
		</Stack>
	);
}
