import { Autocomplete, Box, Button, Group, Modal, Paper, Select, Stack, Text, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { IconAlertTriangle, IconSchool } from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useConfirm } from "@/components/ui/confirm";
import EmptyState from "@/components/ui/empty-state";
import type { DataTableColumn } from "@/components/ui/data-table";

import PageHeader from "@/components/ui/page-header";
import ResponsiveTable from "@/components/ui/responsive-table";
import { SearchInput } from "@/components/ui/search-input";

import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import {
	useClassesQuery,
	useCohortLabels,
	useCreateClass,
	useDeleteClass,
	useUpdateClass,
} from "@/hooks/useClasses";
import { type ClassFormValues, classFormSchema } from "@/schemas/class";
import type { ClassItem } from "@/types/store";
import { formatDate } from "@/utils/date";

export default function ClassesPage() {
	const navigate = useNavigate();
	const [cohortFilter, setCohortFilter] = useState("");
	const {
		searchInput,
		debouncedValue: search,
		handleSearchChange,
	} = useDebouncedSearch();
	const [modalOpen, setModalOpen] = useState(false);
	const [editId, setEditId] = useState<number | null>(null);
	const { confirm } = useConfirm();

	const form = useForm<ClassFormValues>({
		initialValues: { name: "", cohortLabel: "" },
		validate: schemaResolver(classFormSchema),
	});

	const { labels: cohortLabels } = useCohortLabels();
	const { data: classes = [], isLoading, isError } = useClassesQuery(cohortFilter || null);
	const createMut = useCreateClass();
	const updateMut = useUpdateClass();
	const deleteMut = useDeleteClass();

	const openCreate = () => {
		setEditId(null);
		form.setValues({ name: "", cohortLabel: cohortFilter });
		form.resetDirty();
		setModalOpen(true);
	};

	const requestCloseModal = async () => {
		if (form.isDirty()) {
			const ok = await confirm({ title: "关闭班级编辑", message: "内容未保存，确定关闭？" });
			if (!ok) return;
		}
		form.setValues({ name: "", cohortLabel: "" });
		form.resetDirty();
		setEditId(null);
		setModalOpen(false);
	};

	const openEdit = (item: ClassItem) => {
		setEditId(item.id);
		form.setValues({ name: item.name, cohortLabel: item.cohort_label });
		form.resetDirty();
		setModalOpen(true);
	};

	const onSubmit = async (values: ClassFormValues) => {
		const name = values.name.trim();
		const cohortLabel = values.cohortLabel.trim();
		if (editId) {
			await updateMut.mutateAsync({
				id: editId,
				body: { name, cohort_label: cohortLabel },
			});
		} else {
			await createMut.mutateAsync({ name, cohort_label: cohortLabel });
		}
		form.resetDirty();
		setModalOpen(false);
	};

	const handleDelete = async (item: ClassItem) => {
		const ok = await confirm({
			title: "删除班级",
			message: `确定要删除班级「${item.cohort_label ? `${item.cohort_label} ` : ""}${item.name}」吗？\n\n该班 ${item.student_count} 名学生 / ${item.teacher_count} 名教师的这条归属会被清除，他们在其他班级的归属不受影响。已发布作业保留其受众快照。`,
			confirmLabel: "确定删除",
			danger: true,
		});
		if (!ok) return;
		await deleteMut.mutateAsync(item.id);
	};

	const filtered = search
		? classes.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
		: classes;

	const columns: DataTableColumn<ClassItem>[] = [
		{
			key: "cohort_label",
			header: "届别",
			render: (c) =>
				c.cohort_label ? (
					<Text size="sm">{c.cohort_label}</Text>
				) : (
					<Text size="sm" c="dimmed">未标注</Text>
				),
		},
		{
			key: "name",
			header: "班级名称",
			render: (c) => <Text size="sm" fw={500}>{c.name}</Text>,
		},
		{ key: "student_count", header: "学生数", render: (c) => c.student_count },
		{ key: "teacher_count", header: "教师数", render: (c) => c.teacher_count },
		{ key: "assignment_count", header: "作业数", render: (c) => c.assignment_count },
		{
			key: "created_at",
			header: "创建时间",
			render: (c) => <Text size="xs" c="dimmed">{formatDate(c.created_at)}</Text>,
		},
		{
			key: "actions",
			header: "操作",
			render: (c) => (
				<Group gap={4} wrap="nowrap">
					<Button variant="subtle" color="gray" size="sm" onClick={() => navigate(`/admin/classes/${c.id}`)}>
						详情
					</Button>
					<Button variant="subtle" color="gray" size="sm" onClick={() => openEdit(c)}>
						编辑
					</Button>
					<Button variant="subtle" size="sm" color="red" onClick={() => handleDelete(c)}>
						删除
					</Button>
				</Group>
			),
		},
	];

	return (
		<div>
			<PageHeader
				title="班级管理"
				subtitle="按届别组织班级，管理学生与教师归属"
				actions={<Button onClick={openCreate}>新建班级</Button>}
			/>

			<Group gap={12} align="center" wrap="wrap">
				<Box maw={320} style={{ flex: 1 }}>
					<SearchInput
						value={searchInput}
						onChange={handleSearchChange}
						placeholder="搜索班级名称..."
					/>
				</Box>
				<Select
					value={cohortFilter || null}
					onChange={(v) => setCohortFilter(v ?? "")}
					placeholder="全部届别"
					aria-label="届别筛选"
					clearable
					w={200}
					data={cohortLabels.map((label) => ({ value: label, label }))}
				/>
			</Group>

			<Box mt="md">
				{isError ? (
					<EmptyState
						icon={IconAlertTriangle}
						title="班级列表加载失败"
						description="请检查网络或稍后重试"
					/>
				) : (
					<ResponsiveTable<ClassItem>
						columns={columns}
						rows={filtered}
						rowKey={(c) => c.id}
						loading={isLoading}
						bare
						emptyIcon={IconSchool}
						emptyTitle={cohortFilter || search ? "没有匹配的班级" : "暂无班级"}
						emptyDescription={
							cohortFilter || search
								? "换个关键词或清除届别筛选试试"
								: "创建第一个班级后这里会显示"
						}
						renderCard={(c) => (
							<Paper withBorder p="sm">
								<Stack gap={8}>
									<Group justify="space-between" wrap="nowrap" gap={8}>
										<Text size="sm" fw={500} truncate>{c.name}</Text>
										<Text size="xs" c="dimmed">{c.cohort_label || "未标注届别"}</Text>
									</Group>
									<Text size="xs" c="dimmed">
										{c.student_count} 名学生 · {c.teacher_count} 名教师 · {c.assignment_count} 个作业
									</Text>
									<Group gap={8}>
										<Button variant="outline" size="sm" onClick={() => navigate(`/admin/classes/${c.id}`)}>详情</Button>
										<Button variant="outline" size="sm" onClick={() => openEdit(c)}>编辑</Button>
										<Button variant="light" size="sm" color="red" onClick={() => handleDelete(c)}>删除</Button>
									</Group>
								</Stack>
							</Paper>
						)}
					/>
				)}
			</Box>

			<Modal
				opened={modalOpen}
				onClose={() => {
					void requestCloseModal();
				}}
				title={editId ? "编辑班级" : "新建班级"}
				size={520}
				centered
				withinPortal
			>
					<form onSubmit={form.onSubmit(onSubmit)}>
						<Stack gap="sm">
							<Autocomplete
								label="届别（年级标签）"
								description="同一届别下班级名唯一；留空表示不标注届别"
								placeholder="如: 2024级"
								data={cohortLabels}
								{...form.getInputProps("cohortLabel")}
							/>
							<TextInput
								label="班级名称" withAsterisk
								placeholder="如: 护理1班"
								{...form.getInputProps("name")}
							/>
							<Group justify="flex-end" mt="lg" gap="sm">
								<Button
									type="button"
									variant="outline"
									onClick={() => {
										void requestCloseModal();
									}}
								>
									取消
								</Button>
								<Button
									type="submit"
									disabled={createMut.isPending || updateMut.isPending}
								>
									{editId ? "保存" : "创建"}
								</Button>
							</Group>
						</Stack>
					</form>
			</Modal>
		</div>
	);
}
