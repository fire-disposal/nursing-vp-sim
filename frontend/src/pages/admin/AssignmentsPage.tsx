import { Alert, Badge, Box, Button, Group, Modal, SegmentedControl, Select, SimpleGrid, Stack, Text } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconCircleX, IconEdit, IconEye, IconInfoCircle, IconPlus, IconTrash } from "@tabler/icons-react";
import { useCallback, useState } from "react";
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
import { getClasses } from "@/api/classes";
import { queryKeys } from "@/api/query-keys";
import AudienceSelector from "@/components/admin/assignments/AudienceSelector";
import ClassFilter from "@/components/admin/ClassFilter";
import CaseSelector from "@/components/admin/cases/CaseSelector";
import { caseStatusLabel } from "@/components/admin/cases/caseStatus";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import { Switch } from "@mantine/core";
import type { DataTableColumn } from "@/components/ui/data-table";
import { TextInput } from "@mantine/core";
import PageHeader from "@/components/ui/page-header";
import ResponsiveTable from "@/components/ui/responsive-table";
import { SearchInput } from "@/components/ui/search-input";
import { ACTIVITY_LABELS } from "@/config/activity-display";
import { type AssignmentValues, assignmentSchema } from "@/schemas/assignment";
import { fromDatetimeLocal, toDatetimeLocal } from "@/utils/date";

type Schemas = components["schemas"];
type AssignmentListItem = Schemas["AssignmentListItem"];

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
		return <Badge variant="light" color="gray">未开始</Badge>;
	if (now > new Date(item.end_time).getTime())
		return <Badge variant="outline">已结束</Badge>;
	return <Badge variant="light" color="green">进行中</Badge>;
}

function audienceBadge(item: AssignmentListItem) {
	return item.audience_mode === "selected" ? (
		<Badge variant="light" color="violet" size="sm">
			指定 {item.student_count} 人
		</Badge>
	) : (
		<Badge variant="light" color="blue" size="sm">
			全班 {item.student_count} 人
		</Badge>
	);
}

const DEFAULT_VALUES: AssignmentValues = {
	title: "",
	desc: "",
	caseId: 0,
	classId: 0,
	startTime: "",
	endTime: "",
	maxAttempts: 1,
	mode: "guided",
	hideCaseInfo: false,
	audienceMode: "class",
	recipientIds: [],
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
	/** 被编辑作业引用的病例（用于「引用了非 published 病例」的提示）。 */
	const [editingCaseRef, setEditingCaseRef] = useState<{ id: number; name: string } | null>(null);
	const [audienceLocked, setAudienceLocked] = useState(false);
	const [publishedRecipients, setPublishedRecipients] = useState<number | null>(null);
	const { confirm } = useConfirm();

	const form = useForm<AssignmentValues>({
		initialValues: DEFAULT_VALUES,
		validate: schemaResolver(assignmentSchema),
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
	// 病例选择器只列已发布病例：draft/archived 不能用于作业（后端 409）。
	// 缺省 list 不含归档，因此再取一次归档总数用于提示。
	const { data: casesData, isLoading: casesLoading } = useQuery({
		queryKey: queryKeys.cases.managed.list({ scope: "assignmentPicker", limit: 200 }),
		queryFn: () => getManageCases({ limit: 200 }).then((r) => r.data),
		staleTime: 5 * 60_000,
	});
	const { data: archivedCasesData } = useQuery({
		queryKey: queryKeys.cases.managed.list({ scope: "assignmentPickerArchived", limit: 1 }),
		queryFn: () => getManageCases({ limit: 1, status: "archived" }).then((r) => r.data),
		staleTime: 5 * 60_000,
	});
	const { data: classesData } = useQuery({
		queryKey: queryKeys.classes.list(null),
		queryFn: () => getClasses({}).then((r) => r.data),
		staleTime: 5 * 60_000,
	});

	const assignments = listData?.items ?? [];
	const manageableCases = casesData?.items ?? [];
	const cases = manageableCases.filter((c) => c.status === "published");
	const draftCaseCount = manageableCases.filter((c) => c.status === "draft").length;
	const archivedCaseCount = archivedCasesData?.total ?? 0;
	const unavailableHint = [
		draftCaseCount > 0 ? `${draftCaseCount} 个草稿病例` : null,
		archivedCaseCount > 0 ? `${archivedCaseCount} 个已归档病例` : null,
	]
		.filter(Boolean)
		.join("、");
	const classes = classesData ?? [];

	// 编辑已有作业时，它引用的病例可能已不是 published（旧数据或后续归档）。
	const referencedCaseId = editingId && editingCaseRef ? editingCaseRef.id : null;
	const referencedCaseUnavailable =
		referencedCaseId != null && !cases.some((c) => c.id === referencedCaseId)
			? {
					name: editingCaseRef?.name ?? `#${referencedCaseId}`,
					status: manageableCases.some((c) => c.id === referencedCaseId) ? "draft" : "archived",
				}
			: null;

	const selectedClass = classes.find((c) => c.id === form.values.classId);
	const classLabel = selectedClass
		? selectedClass.cohort_label
			? `${selectedClass.cohort_label} ${selectedClass.name}`
			: selectedClass.name
		: "所选班级";

	const audiencePreview = audienceLocked
		? `已发布给 ${publishedRecipients ?? 0} 名学生（${form.values.audienceMode === "selected" ? "指定学生" : "全班"}快照，发布后不再随班级成员变动）`
		: form.values.audienceMode === "class"
			? `将发布给 ${selectedClass?.student_count ?? 0} 名学生：${classLabel} 全班 ${selectedClass?.student_count ?? 0} 人`
			: `将发布给 ${form.values.recipientIds.length} 名学生：${classLabel} 指定 ${form.values.recipientIds.length} 人`;

	const filteredAssignments = search
		? assignments.filter((a) => a.title?.toLowerCase().includes(search.toLowerCase()))
		: assignments;

	const openCreate = () => {
		setEditingId(null);
		setEditingCaseRef(null);
		setAudienceLocked(false);
		setPublishedRecipients(null);
		form.setValues(DEFAULT_VALUES);
		form.resetDirty();
		setModalOpen(true);
	};

	const openEdit = async (id: string) => {
		try {
			const res = await fetchAssignment(id);
			const d = res.data;
			setEditingId(id);
			setEditingCaseRef({ id: d.case_id, name: d.case_name });
			// 受众与病例/班级在有人开始练习后即固化，后续只能改非受众字段。
			const locked = d.completed_count > 0 || d.scored_count > 0;
			setAudienceLocked(locked);
			setPublishedRecipients(locked ? (d.recipient_ids?.length ?? d.student_count) : null);
			form.setValues({
				title: d.title,
				desc: d.description || "",
				caseId: d.case_id,
				classId: d.class_id,
				startTime: toDatetimeLocal(d.start_time),
				endTime: toDatetimeLocal(d.end_time),
				maxAttempts: d.max_attempts ?? 0,
				mode: d.behavior?.mode === "assessment" ? "assessment" : "guided",
				hideCaseInfo: d.behavior?.hide_case_info === true,
				audienceMode: d.audience_mode === "selected" ? "selected" : "class",
				recipientIds: d.recipient_ids ?? [],
			});
			form.resetDirty();
			setModalOpen(true);
		} catch (e: unknown) {
			toast.apiError(e, "加载失败");
		}
	};

	const onSubmit = async (values: AssignmentValues) => {
		const shared: Schemas["AssignmentCreateRequest"] = {
			case_id: values.caseId,
			class_id: values.classId,
			title: values.title.trim(),
			description: values.desc.trim() || null,
			start_time: fromDatetimeLocal(values.startTime) ?? "",
			end_time: fromDatetimeLocal(values.endTime) ?? "",
			max_attempts: values.maxAttempts,
			behavior: {
				mode: values.mode,
				hide_case_info: values.hideCaseInfo,
			},
			audience:
				values.audienceMode === "selected"
					? { mode: "selected", user_ids: values.recipientIds }
					: { mode: "class" },
		};
		try {
			if (editingId) {
				// 有训练记录时不得回传 case_id/班级/受众：后端会拒绝受众或病例变更。
				const patch: Schemas["AssignmentUpdateRequest"] = audienceLocked
					? {
							title: shared.title,
							description: shared.description,
							start_time: shared.start_time,
							end_time: shared.end_time,
							max_attempts: shared.max_attempts,
							behavior: shared.behavior,
						}
					: {
							...shared,
							case_id: values.caseId,
							class_id: values.classId,
						};
				await updateAssignment(editingId, patch);
				toast.success("更新成功");
			} else {
				await createAssignment(shared);
				toast.success("创建成功");
			}
			queryClient.invalidateQueries({ queryKey: queryKeys.assignments.all });
			setModalOpen(false);
		} catch (e: unknown) {
			toast.apiError(e, audienceLocked ? "保存失败（受众已锁定）" : "操作失败");
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

	const handleToggleClose = async (a: AssignmentListItem) => {
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

	const columns: DataTableColumn<AssignmentListItem>[] = [
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
			key: "audience",
			header: "受众",
			render: (a) => audienceBadge(a),
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
				a.student_count > 0 ? `${a.completed_count}/${a.student_count}` : "-",
		},
		{
			key: "status",
			header: "状态",
			render: (a) => (
				<Group gap={6} wrap="nowrap">
					{statusBadge(a)}
					{a.is_closed && (
						<Badge variant="light" color="gray" size="xs">已关闭</Badge>
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
						variant="subtle" color="gray"
						w={44} h={44} p={0}
						onClick={() => navigate(`/admin/assignments/${a.id}`)}
						title="详情"
					>
						<IconEye size={15} />
					</Button>
					<Button
						variant="subtle" color="gray"
						w={44} h={44} p={0}
						onClick={() => openEdit(a.id)}
						title="编辑"
					>
						<IconEdit size={15} />
					</Button>
					<Button
						variant="subtle" color="gray"
						w={44} h={44} p={0}
						onClick={() => handleToggleClose(a)}
						title={a.is_closed ? "重新开放" : "关闭"}
					>
						<IconCircleX size={15} />
					</Button>
					<Button
						variant="subtle"
						w={44} h={44} p={0}
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

			<ResponsiveTable<AssignmentListItem>
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
							<Group gap={6}>
								{audienceBadge(a)}
							</Group>
							<Text size="xs" c="dimmed">
								{formatWindow(a.start_time)} ~ {formatWindow(a.end_time)}
							</Text>
							<Group justify="space-between" align="center" gap={8} wrap="wrap">
								<Text size="xs" c="dimmed">
									{a.completed_count}/{a.student_count} 完成
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

			<Modal
				opened={modalOpen}
				onClose={async () => {
					if (form.isDirty()) {
						const ok = await confirm({ title: "未保存的更改", message: "内容未保存，确定关闭？", danger: true });
						if (!ok) return;
					}
					setModalOpen(false);
				}}
				title={editingId ? "编辑作业" : "创建作业"}
				size={620}
				centered
				withinPortal
			>
					<form onSubmit={form.onSubmit(onSubmit)}>
						<Stack gap="md">
							{audienceLocked && (
								<Alert color="orange" variant="light" icon={<IconInfoCircle size={16} />}>
									<Text size="xs">
										已有学生开始练习：病例、班级与已发布受众已固化，不能再修改（对全班发布的作业，之后新增的班级成员也不会进入这份作业）。仍可调整标题、说明、时间窗口、尝试次数与训练模式。
									</Text>
								</Alert>
							)}
							<TextInput label="标题" withAsterisk placeholder="作业标题" {...form.getInputProps("title")} />
							<TextInput label="说明（可选）" placeholder="补充说明" {...form.getInputProps("desc")} />
							<Box>
								<Text size="sm" fw={500} mb={4}>病例</Text>
								<CaseSelector
									cases={cases}
									value={form.values.caseId || 0}
									onChange={(id) => form.setFieldValue("caseId", id)}
									loading={casesLoading}
									emptyHint="暂无可选病例：病例需先「发布」才能用于作业"
								/>
								{referencedCaseUnavailable && (
									<Alert color="orange" variant="light" p="xs" mt={4} icon={<IconInfoCircle size={14} />}>
										<Text size="xs">
											当前作业引用的病例「{referencedCaseUnavailable.name}」是{caseStatusLabel(referencedCaseUnavailable.status)}状态，
											{audienceLocked
												? "且已固化不能修改；学生无法开始新的练习。"
												: "不能用于作业（后端会拒绝）；请改选已发布的病例。"}
										</Text>
									</Alert>
								)}
								{unavailableHint && (
									<Text size="xs" c="dimmed" mt={4}>
										另有 {unavailableHint}不可选：病例需先「发布」才能用于作业，已归档病例只能作为历史检索。
									</Text>
								)}
								{form.errors.caseId ? (
									<Text size="sm" fw={500} c="red" mt={4}>{form.errors.caseId}</Text>
								) : null}
							</Box>
							<Select
								label="班级" withAsterisk
								placeholder="选择班级…"
								value={form.values.classId ? String(form.values.classId) : null}
								onChange={(v) => {
									form.setFieldValue("classId", v ? Number(v) : 0);
									form.setFieldValue("recipientIds", []);
								}}
								error={form.errors.classId}
								disabled={audienceLocked}
								data={classes.map((c) => ({
									value: String(c.id),
									label: c.cohort_label ? `${c.cohort_label} ${c.name}` : c.name,
								}))}
							/>
							<Box>
								<Text size="sm" fw={500} mb={4}>受众</Text>
								<SegmentedControl
									fullWidth
									value={form.values.audienceMode}
									onChange={(v) =>
										form.setFieldValue("audienceMode", v as "class" | "selected")
									}
									disabled={audienceLocked || !form.values.classId}
									data={[
										{ value: "class", label: "全班学生" },
										{ value: "selected", label: "指定学生" },
									]}
								/>
								<Text size="xs" c="dimmed" mt={4}>
									受众在发布时固化为快照：全班模式下之后新增的班级成员不会自动进入这份作业。
								</Text>
							</Box>
							{form.values.audienceMode === "selected" && form.values.classId > 0 && (
								<AudienceSelector
									classId={form.values.classId}
									value={form.values.recipientIds}
									onChange={(ids) => form.setFieldValue("recipientIds", ids)}
									disabled={audienceLocked}
								/>
							)}
							<Alert
								color={form.errors.recipientIds ? "red" : "blue"}
								variant="light"
								p="xs"
							>
								<Text size="xs">
									{form.errors.recipientIds ?? audiencePreview}
								</Text>
							</Alert>
							<SimpleGrid cols={2} spacing="sm">
								<TextInput label="开始时间" withAsterisk type="datetime-local" {...form.getInputProps("startTime")} />
								<TextInput label="截止时间" withAsterisk type="datetime-local" {...form.getInputProps("endTime")} />
							</SimpleGrid>
							{(() => {
								const selected = cases.find((c) => c.id === form.values.caseId);
								const caps = selected?.capabilities;
								if (!caps) return null;
								const enabled = Object.entries(caps).filter(([, v]) => v);
								if (enabled.length === 0) return null;
								return (
									<Group gap={4} wrap="wrap" mt={-8} mb={4}>
										{enabled.map(([k]) => (
											<Badge key={k} variant="light" color="blue" size="xs">
												{ACTIVITY_LABELS[k] ?? k}
											</Badge>
										))}
									</Group>
								);
							})()}
							<TextInput
								label="最大尝试次数"
								type="number"
								min={0}
								description="默认 1 次；填写 0 表示不限制"
								value={String(form.values.maxAttempts)}
								onChange={(e) => {
									const raw = e.currentTarget.value;
									form.setFieldValue(
										"maxAttempts",
										raw === "" ? 1 : Math.max(0, Number(raw)),
									);
								}}
								error={form.errors.maxAttempts}
							/>
							<Select
								label="训练模式"
								description={
									form.values.mode === "guided"
										? "提供问诊线索、查体解读和沟通状态反馈"
										: "隐藏训练提示、状态数值和消息修正，用于正式考核"
								}
								data={[
									{ value: "guided", label: "引导训练" },
									{ value: "assessment", label: "独立考核" },
								]}
								{...form.getInputProps("mode")}
							/>
							<Box>
								<Group
									justify="space-between"
									align="center"
									wrap="nowrap"
									p="sm"
									style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 8 }}
								>
									<div>
										<Text size="sm" fw={500}>隐藏病例信息</Text>
										<Text size="xs" c="dimmed">训练中不显示病例标题/患者信息，结束后揭示（病例固定，不做随机抽取）</Text>
									</div>
									<Switch {...form.getInputProps("hideCaseInfo", { type: "checkbox" })} />
								</Group>
							</Box>
							<Group justify="flex-end" mt="lg" gap="sm">
								<Button
									type="button"
									variant="outline"
									onClick={async () => {
										if (form.isDirty()) {
											const ok = await confirm({ title: "未保存的更改", message: "内容未保存，确定关闭？", danger: true });
											if (!ok) return;
										}
										setModalOpen(false);
									}}
								>
									取消
								</Button>
								<Button type="submit" disabled={form.submitting}>
									{form.submitting ? (editingId ? "保存中..." : "发布中...") : (editingId ? "保存" : "发布")}
								</Button>
							</Group>
						</Stack>
					</form>
			</Modal>
		</Stack>
	);
}
