import { Box, Button, Group, Modal, Paper, Select, Stack, Text } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { IconSchool } from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useConfirm } from "@/components/ui/confirm";
import type { DataTableColumn } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import PageHeader from "@/components/ui/page-header";
import ResponsiveTable from "@/components/ui/responsive-table";
import { SearchInput } from "@/components/ui/search-input";
import Tabs from "@/components/ui/tabs";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import {
	useClassesQuery,
	useCreateClass,
	useCreateGrade,
	useDeleteClass,
	useDeleteGrade,
	useGradesQuery,
	useUpdateClass,
	useUpdateGrade,
} from "@/hooks/useGradesClasses";
import { type GradeClassValues, gradeClassSchema } from "@/schemas/grade-class";
import type { ClassItem, Grade } from "@/types/store";
import { formatDate } from "@/utils/date";

export default function GradesClassesPage() {
	const navigate = useNavigate();
	const [tab, setTab] = useState<"grades" | "classes">("grades");
	const [gradeFilter, setGradeFilter] = useState("");
	const {
		searchInput: gradeSearchInput,
		debouncedValue: gradeSearch,
		handleSearchChange: handleGradeSearchChange,
	} = useDebouncedSearch();
	const {
		searchInput: classSearchInput,
		debouncedValue: classSearch,
		handleSearchChange: handleClassSearchChange,
	} = useDebouncedSearch();
	const [modalOpen, setModalOpen] = useState(false);
	const [editId, setEditId] = useState<number | null>(null);
	const { confirm } = useConfirm();

	const form = useForm<GradeClassValues>({
		initialValues: { name: "", gradeId: "" },
		validate: schemaResolver(gradeClassSchema),
	});

	const { data: grades = [], isLoading } = useGradesQuery();
	const { data: classes = [], isLoading: classesLoading } = useClassesQuery(
		gradeFilter ? Number(gradeFilter) : undefined,
	);
	const createGradeMut = useCreateGrade();
	const updateGradeMut = useUpdateGrade();
	const deleteGradeMut = useDeleteGrade();
	const createClassMut = useCreateClass();
	const updateClassMut = useUpdateClass();
	const deleteClassMut = useDeleteClass();

	const openCreate = () => {
		setEditId(null);
		form.setValues({ name: "", gradeId: "" });
		form.resetDirty();
		setModalOpen(true);
	};

	const requestCloseModal = async () => {
		if (form.isDirty()) {
			const ok = await confirm({ title: `关闭${tab === "grades" ? "年级" : "班级"}编辑`, message: "内容未保存，确定关闭？" });
			if (!ok) return;
		}
		form.setValues({ name: "", gradeId: "" });
		form.resetDirty();
		setEditId(null);
		setModalOpen(false);
	};
	const openEdit = (item: Grade | ClassItem) => {
		setEditId(item.id);
		form.setValues({
			name: item.name,
			gradeId:
				tab === "classes" ? String((item as ClassItem).grade_id) : "",
		});
		form.resetDirty();
		setModalOpen(true);
	};

	const onSubmit = async (values: GradeClassValues) => {
		try {
			if (tab === "grades") {
				if (editId) {
					await updateGradeMut.mutateAsync({ id: editId, name: values.name.trim() });
				} else {
					await createGradeMut.mutateAsync(values.name.trim());
				}
			} else {
				if (!values.gradeId) {
					form.setFieldError("gradeId", "请选择所属年级");
					return;
				}
				if (editId) {
					await updateClassMut.mutateAsync({
						id: editId,
						body: {
							name: values.name.trim(),
							grade_id: Number(values.gradeId),
						},
					});
				} else {
					await createClassMut.mutateAsync({
						gradeId: Number(values.gradeId),
						name: values.name.trim(),
					});
				}
			}
			setModalOpen(false);
		} finally {
			// mutation's useApiMutation handles toast + invalidation
		}
	};

	const handleDeleteGrade = async (item: Grade) => {
		const ok = await confirm({
			title: "删除年级",
			message: `确定要删除年级「${item.name}」吗？将同时删除该年级下所有班级，学生班级归属将被清除。`,
			danger: true,
		});
		if (!ok) return;
		try {
			await deleteGradeMut.mutateAsync(item.id);
		} catch {
			// toast handled by useApiMutation
		}
	};

	const handleDeleteClass = async (item: ClassItem) => {
		const ok = await confirm({
			title: "删除班级",
			message: `确定要删除班级「${item.name}」吗？该班级中学生将变为无归属状态。`,
			danger: true,
		});
		if (!ok) return;
		try {
			await deleteClassMut.mutateAsync(item.id);
		} catch {
			// toast handled by useApiMutation
		}
	};

	const tabs = [
		{ key: "grades", label: "年级管理" },
		{ key: "classes", label: "班级管理" },
	];

	const filteredGrades = (grades ?? []).filter(
		(g: Grade) =>
			!gradeSearch || g.name.toLowerCase().includes(gradeSearch.toLowerCase()),
	);
	const filteredClasses = (classes ?? []).filter(
		(c: ClassItem) =>
			!classSearch || c.name.toLowerCase().includes(classSearch.toLowerCase()),
	);

	const actionsCell = (
		item: Grade | ClassItem,
		onDelete: () => void,
	) => (
		<Group gap={8} wrap="nowrap">
			<Button variant="subtle" color="gray" size="sm" onClick={() => openEdit(item)}>
				编辑
			</Button>
			<Button variant="subtle" size="sm" color="red" onClick={onDelete}>
				删除
			</Button>
		</Group>
	);

	const gradeColumns: DataTableColumn<Grade>[] = [
		{ key: "name", header: "年级名称" },
		{ key: "class_count", header: "班级数" },
		{ key: "student_count", header: "学生数" },
		{
			key: "created_at",
			header: "创建时间",
			render: (g) => <Text size="xs" c="dimmed">{formatDate(g.created_at)}</Text>,
		},
		{
			key: "actions",
			header: "操作",
			render: (g) => actionsCell(g, () => handleDeleteGrade(g)),
		},
	];

	const classColumns: DataTableColumn<ClassItem>[] = [
		{ key: "grade_name", header: "所属年级" },
		{ key: "name", header: "班级名称" },
		{ key: "student_count", header: "学生数" },
		{
			key: "created_at",
			header: "创建时间",
			render: (c) => <Text size="xs" c="dimmed">{formatDate(c.created_at)}</Text>,
		},
		{
			key: "actions",
			header: "操作",
			render: (c) => actionsCell(c, () => handleDeleteClass(c)),
		},
	];

	return (
		<div>
			<PageHeader
				title="班级管理"
				subtitle="管理年级和班级，组织学生归属"
				actions={
					<Button onClick={openCreate}>
						新建{tab === "grades" ? "年级" : "班级"}
					</Button>
				}
			/>

			<Tabs
				tabs={tabs}
				activeTab={tab}
				onChange={(k) => setTab(k as "grades" | "classes")}
			/>

			<Stack gap="md" mt="md">
				{tab === "classes" && (
					<Group gap={12} align="center" wrap="wrap">
						<Box maw={320} style={{ flex: 1 }}>
							<SearchInput
								value={classSearchInput}
								onChange={handleClassSearchChange}
								placeholder="搜索班级..."
								aria-label="搜索班级"
							/>
						</Box>
						<Select
							value={gradeFilter || null}
							onChange={(v) => setGradeFilter(v ?? "")}
							data={[
								{ value: "", label: `全部年级（${grades.length}）` },
								...grades.map((g) => ({
									value: String(g.id),
									label: `${g.name}（${g.class_count ?? 0}个班）`,
								})),
							]}
							w={220}
						/>
					</Group>
				)}

				{tab === "grades" && (
					<Box maw={320}>
						<SearchInput
							value={gradeSearchInput}
							onChange={handleGradeSearchChange}
							placeholder="搜索年级..."
							aria-label="搜索年级"
						/>
					</Box>
				)}
			</Stack>

			{tab === "grades" ? (
				<Box mt="md">
					<ResponsiveTable<Grade>
						columns={gradeColumns}
						rows={filteredGrades}
						rowKey={(g) => g.id}
						loading={isLoading}
						emptyIcon={IconSchool}
						emptyTitle="暂无年级"
						emptyDescription="创建第一个年级后这里会显示"
						renderCard={(g) => (
							<Paper withBorder radius="md" p="sm">
								<Stack gap={8}>
									<Text size="sm" fw={500}>{g.name}</Text>
									<Text size="xs" c="dimmed">
										{g.class_count ?? 0} 个班级 · {g.student_count ?? 0} 名学生
									</Text>
									<Group gap={8}>
										<Button variant="outline" size="sm" onClick={() => openEdit(g)}>编辑</Button>
										<Button variant="outline" size="sm" onClick={() => handleDeleteGrade(g)}>删除</Button>
									</Group>
								</Stack>
							</Paper>
						)}
					/>
				</Box>
			) : (
				<Box mt="md">
					<ResponsiveTable<ClassItem>
						columns={classColumns}
						rows={filteredClasses}
						rowKey={(c) => c.id}
						loading={classesLoading}
						emptyIcon={IconSchool}
						emptyTitle="暂无班级"
						emptyDescription="创建第一个班级后这里会显示"
						renderCard={(c) => (
							<Paper withBorder radius="md" p="sm">
								<Stack gap={8}>
									<Text size="sm" fw={500}>{c.name}</Text>
									<Text size="xs" c="dimmed">
										{c.grade_name} · {c.student_count ?? 0} 名学生
									</Text>
									<Group gap={8}>
										<Button variant="outline" size="sm" onClick={() => navigate(`/admin/classes/${c.id}`)}>详情</Button>
										<Button variant="outline" size="sm" onClick={() => openEdit(c)}>编辑</Button>
										<Button variant="outline" size="sm" onClick={() => handleDeleteClass(c)}>删除</Button>
									</Group>
								</Stack>
							</Paper>
						)}
					/>
				</Box>
			)}

			<Modal
				opened={modalOpen}
				onClose={() => {
					void requestCloseModal();
				}}
				title={
					editId
						? `编辑${tab === "grades" ? "年级" : "班级"}`
						: `新建${tab === "grades" ? "年级" : "班级"}`
				}
				size={560}
				centered
				withinPortal
			>
					<form onSubmit={form.onSubmit(onSubmit)}>
						<Stack gap="sm">
							{tab === "classes" && (
								<Select
									label="所属年级"
									value={form.values.gradeId || null}
									onChange={(v) => form.setFieldValue("gradeId", v ?? "")}
									error={form.errors.gradeId}
									data={[
										{ value: "", label: "请选择年级" },
										...grades.map((g) => ({
											value: String(g.id),
											label: g.name,
										})),
									]}
								/>
							)}
							<Input
								label="名称"
								placeholder={tab === "grades" ? "如: 2024级" : "如: 护理1班"}
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
								<Button type="submit" disabled={form.submitting}>
									{editId ? "保存" : "创建"}
								</Button>
							</Group>
						</Stack>
					</form>
			</Modal>
		</div>
	);
}
