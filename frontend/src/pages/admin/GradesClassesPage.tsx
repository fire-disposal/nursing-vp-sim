import { zodResolver } from "@hookform/resolvers/zod";
import { GraduationCap } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useShallow } from "zustand/react/shallow";
import { useToast } from "@/components/Toast";
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
import PageHeader from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import { type GradeClassValues, gradeClassSchema } from "@/schemas/grade-class";
import useGradesClassesStore from "@/stores/gradesClassesStore";
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
	const toast = useToast();
	const { confirm } = useConfirm();

	const form = useForm<GradeClassValues>({
		resolver: zodResolver(gradeClassSchema),
		defaultValues: { name: "", gradeId: "" },
	});

	const {
		grades,
		classes,
		loading,
		classesLoading,
		fetchGrades,
		fetchClasses,
		createGrade,
		updateGrade,
		deleteGrade,
		createClass,
		updateClass,
		deleteClass,
	} = useGradesClassesStore(
		useShallow((s) => ({
			grades: s.grades,
			classes: s.classes,
			loading: s.loading,
			classesLoading: s.classesLoading,
			fetchGrades: s.fetchGrades,
			fetchClasses: s.fetchClasses,
			createGrade: s.createGrade,
			updateGrade: s.updateGrade,
			deleteGrade: s.deleteGrade,
			createClass: s.createClass,
			updateClass: s.updateClass,
			deleteClass: s.deleteClass,
		})),
	);

	useEffect(() => {
		fetchGrades();
	}, [fetchGrades]);
	useEffect(() => {
		fetchClasses(gradeFilter ? Number(gradeFilter) : undefined);
	}, [gradeFilter, fetchClasses]);

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
					await updateGrade(editId, values.name.trim());
				} else {
					await createGrade(values.name.trim());
				}
				fetchGrades();
			} else {
				if (!values.gradeId) {
					form.setError("gradeId", { message: "请选择所属年级" });
					return;
				}
				if (editId) {
					await updateClass(editId, {
						name: values.name.trim(),
						grade_id: Number(values.gradeId),
					});
				} else {
					await createClass(Number(values.gradeId), values.name.trim());
				}
				fetchClasses(gradeFilter ? Number(gradeFilter) : undefined);
			}
			setModalOpen(false);
			toast.success(editId ? "已更新" : "已创建");
		} catch (e: unknown) {
			toast.apiError(e, "操作失败");
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
			await deleteGrade(item.id);
			fetchGrades();
			fetchClasses(gradeFilter ? Number(gradeFilter) : undefined);
			toast.success("已删除");
		} catch (e: unknown) {
			toast.apiError(e, "操作失败");
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
			await deleteClass(item.id);
			fetchClasses(gradeFilter ? Number(gradeFilter) : undefined);
			toast.success("已删除");
		} catch (e: unknown) {
			toast.apiError(e, "操作失败");
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
						/>
					</div>
				</div>
			)}

			{tab === "grades" ? (
				<DataTable<Grade>
					columns={gradeColumns}
					rows={filteredGrades}
					rowKey={(g) => g.id}
					loading={loading}
					emptyIcon={GraduationCap}
					emptyTitle="暂无年级"
					emptyDescription="创建第一个年级后这里会显示"
				/>
			) : (
				<DataTable<ClassItem>
					columns={classColumns}
					rows={filteredClasses}
					rowKey={(c) => c.id}
					loading={classesLoading}
					emptyIcon={GraduationCap}
					emptyTitle="暂无班级"
					emptyDescription="创建第一个班级后这里会显示"
				/>
			)}

			<Dialog
				open={modalOpen}
				onOpenChange={(o) => {
					if (!o) {
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
									onClick={() => setModalOpen(false)}
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
