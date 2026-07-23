import { zodResolver } from "@hookform/resolvers/zod";
import { GraduationCap } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
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
import PageHeader from "@/components/ui/page-header";
import ResponsiveTable from "@/components/ui/responsive-table";
import { SearchInput } from "@/components/ui/search-input";
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
import { cn } from "@/utils/cn";
import { formatDate } from "@/utils/date";
import { selectClass } from "@/utils/styles";

export default function GradesClassesPage() {
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
		resolver: zodResolver(gradeClassSchema),
		defaultValues: { name: "", gradeId: "" },
	});
	const { formState: { isDirty } } = form;

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
		form.reset({ name: "", gradeId: "" });
		setModalOpen(true);
	};
	const openEdit = (item: Grade | ClassItem) => {
		setEditId(item.id);
		form.reset({
			name: item.name,
			gradeId:
				tab === "classes" ? String((item as ClassItem).grade_id) : "",
		});
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
					form.setError("gradeId", { message: "请选择所属年级" });
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
		<div className="flex gap-2">
			<Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
				编辑
			</Button>
			<Button
				variant="ghost"
				size="sm"
				className="text-destructive hover:bg-destructive/10"
				onClick={onDelete}
			>
				删除
			</Button>
		</div>
	);

	const gradeColumns: DataTableColumn<Grade>[] = [
		{ key: "name", header: "年级名称" },
		{ key: "class_count", header: "班级数" },
		{ key: "student_count", header: "学生数" },
		{
			key: "created_at",
			header: "创建时间",
			cellClassName: "text-xs text-muted-foreground",
			render: (g) => formatDate(g.created_at),
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
			cellClassName: "text-xs text-muted-foreground",
			render: (c) => formatDate(c.created_at),
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

			<div className="flex gap-0 mb-4 border-b-2 border-border">
				{tabs.map((t) => (
					<button
						key={t.key}
						type="button"
						onClick={() => setTab(t.key as "grades" | "classes")}
						className={cn(
							"px-6 py-2 border-none bg-transparent cursor-pointer border-b-2 mb-[-2px]",
							tab === t.key
								? "font-semibold text-primary border-primary"
								: "font-normal text-muted-foreground border-transparent",
						)}
					>
						{t.label}
					</button>
				))}
			</div>

			{tab === "classes" && (
				<div className="mb-4 flex items-center gap-3">
					<div className="flex-1 max-w-xs">
						<SearchInput
							value={classSearchInput}
							onChange={handleClassSearchChange}
							placeholder="搜索班级..."
							aria-label="搜索班级"
						/>
					</div>
					<select
						value={gradeFilter}
						onChange={(e) => setGradeFilter(e.target.value)}
						className={selectClass}
					>
						<option value="">全部年级（{grades.length}）</option>
						{grades.map((g) => (
							<option key={g.id} value={g.id}>
								{g.name}（{g.class_count ?? 0}个班）
							</option>
						))}
					</select>
				</div>
			)}

			{tab === "grades" && (
				<div className="mb-4">
					<div className="flex-1 max-w-xs">
						<SearchInput
							value={gradeSearchInput}
							onChange={handleGradeSearchChange}
							placeholder="搜索年级..."
							aria-label="搜索年级"
						/>
					</div>
				</div>
			)}

			{tab === "grades" ? (
				<ResponsiveTable<Grade>
					columns={gradeColumns}
					rows={filteredGrades}
					rowKey={(g) => g.id}
					loading={isLoading}
					emptyIcon={GraduationCap}
					emptyTitle="暂无年级"
					emptyDescription="创建第一个年级后这里会显示"
					renderCard={(g) => (
						<div className="rounded-lg border bg-card p-3 space-y-2">
							<div className="text-sm font-medium">{g.name}</div>
							<div className="text-xs text-muted-foreground">
								{g.class_count ?? 0} 个班级 · {g.student_count ?? 0} 名学生
							</div>
							<div className="flex gap-1">
								<Button variant="outline" size="sm" onClick={() => openEdit(g)}>编辑</Button>
								<Button variant="outline" size="sm" onClick={() => handleDeleteGrade(g)}>删除</Button>
							</div>
						</div>
					)}
				/>
			) : (
				<ResponsiveTable<ClassItem>
					columns={classColumns}
					rows={filteredClasses}
					rowKey={(c) => c.id}
					loading={classesLoading}
					emptyIcon={GraduationCap}
					emptyTitle="暂无班级"
					emptyDescription="创建第一个班级后这里会显示"
					renderCard={(c) => (
						<div className="rounded-lg border bg-card p-3 space-y-2">
							<div className="text-sm font-medium">{c.name}</div>
							<div className="text-xs text-muted-foreground">
								{c.grade_name} · {c.student_count ?? 0} 名学生
							</div>
							<div className="flex gap-1">
								<Button variant="outline" size="sm" onClick={() => openEdit(c)}>编辑</Button>
								<Button variant="outline" size="sm" onClick={() => handleDeleteClass(c)}>删除</Button>
							</div>
						</div>
					)}
				/>
			)}

			<Dialog
				open={modalOpen}
				onOpenChange={(o) => {
					if (!o) {
						if (isDirty && !window.confirm("内容未保存，确定关闭？")) return;
						form.reset({ name: "", gradeId: "" });
						setEditId(null);
						setModalOpen(false);
					}
				}}
			>
				<DialogContent
					title={
						editId
							? `编辑${tab === "grades" ? "年级" : "班级"}`
							: `新建${tab === "grades" ? "年级" : "班级"}`
					}
					maxWidth={560}
				>
					<Form {...form}>
						<form
							onSubmit={form.handleSubmit(onSubmit)}
							className="flex flex-col gap-3"
						>
							{tab === "classes" && (
								<FormField
									control={form.control}
									name="gradeId"
									render={({ field }) => (
										<FormItem>
											<FormLabel>所属年级</FormLabel>
											<FormControl>
												<select
													className="w-full px-3 py-2 border border-border rounded-md text-sm bg-card focus-ring"
													{...field}
												>
													<option value="">请选择年级</option>
													{grades.map((g) => (
														<option key={g.id} value={g.id}>
															{g.name}
														</option>
													))}
												</select>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
							)}
							<FormField
								control={form.control}
								name="name"
								render={({ field }) => (
									<FormItem>
										<FormLabel>名称</FormLabel>
										<FormControl>
											<input
												className="w-full px-3 py-2 border border-border rounded-md text-sm focus-ring"
												placeholder={tab === "grades" ? "如: 2024级" : "如: 护理1班"}
												{...field}
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
									onClick={() => {
										if (isDirty && !window.confirm("内容未保存，确定关闭？")) return;
										setModalOpen(false);
									}}
								>
									取消
								</Button>
								<Button onClick={form.handleSubmit(onSubmit)} disabled={form.formState.isSubmitting}>
									{editId ? "保存" : "创建"}
								</Button>
							</DialogFooter>
						</form>
					</Form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
