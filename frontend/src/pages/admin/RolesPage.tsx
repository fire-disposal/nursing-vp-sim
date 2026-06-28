import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Save, Shield, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { createRole, deleteRole, getRoles, updateRole } from "@/api/admin/roles";
import ExportButton from "@/components/ExportButton";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import EmptyState from "@/components/ui/empty-state";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import { type RoleCreateValues, roleCreateSchema } from "@/schemas/role";

interface RoleItem {
	id: number;
	name: string;
	display_name: string;
	is_system: boolean;
	permissions: string[];
	user_count: number;
}

const ALL_PERMISSIONS = [
	{ key: "user_manage", label: "用户管理" },
	{ key: "role_manage", label: "角色管理" },
	{ key: "grade_class_manage", label: "班级管理" },
	{ key: "case_manage", label: "病例管理" },
	{ key: "training_access", label: "训练功能" },
	{ key: "score_review", label: "成绩查看" },
	{ key: "stats_view", label: "数据统计" },
	{ key: "qa_access", label: "护理问答" },
	{ key: "llm_monitor", label: "LLM 监控" },
	{ key: "api_manage", label: "API 管理" },
	{ key: "prompt_manage", label: "Prompt 管理" },
	{ key: "feedback_review", label: "反馈管理" },
	{ key: "export_data", label: "数据导出" },
	{ key: "record_notes", label: "训练批注" },
];

export default function RolesPage() {
	const toast = useToast();
	const [roles, setRoles] = useState<RoleItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [editId, setEditId] = useState<number | null>(null);
	const [editPerms, setEditPerms] = useState<string[]>([]);
	const [showCreate, setShowCreate] = useState(false);
	const { searchInput, debouncedValue: search, handleSearchChange } = useDebouncedSearch();
	const { confirm } = useConfirm();

	const form = useForm<RoleCreateValues>({
		resolver: zodResolver(roleCreateSchema),
		defaultValues: { name: "", displayName: "" },
	});

	const loadRoles = useCallback(async () => {
		setLoading(true);
		try {
			const { data } = await getRoles(search);
			setRoles(data || []);
		} catch {
			toast.error("加载角色列表失败");
		} finally {
			setLoading(false);
		}
	}, [search]);

	useEffect(() => {
		loadRoles();
	}, [loadRoles]);

	const togglePerm = (perm: string) => {
		setEditPerms((prev) =>
			prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm],
		);
	};

	const startEdit = (role: RoleItem) => {
		if (editId !== null && editId !== role.id) {
			if (!window.confirm("放弃当前编辑的修改？")) return;
		}
		setEditId(role.id);
		setEditPerms([...role.permissions]);
	};

	const saveEdit = async (roleId: number) => {
		try {
			await updateRole(roleId, { permissions: editPerms });
			toast.success("权限已保存");
			setEditId(null);
			loadRoles();
		} catch (e: unknown) {
			toast.apiError(e, "保存失败");
		}
	};

	const onSubmit = async (values: RoleCreateValues) => {
		try {
			await createRole({
				name: values.name,
				display_name: values.displayName,
				permissions: [],
			});
			toast.success("角色已创建，请编辑权限");
			form.reset();
			setShowCreate(false);
			loadRoles();
		} catch (e: unknown) {
			toast.apiError(e, "创建失败");
		}
	};

	const handleDelete = async (id: number, name: string) => {
		const ok = await confirm({
			title: "删除角色",
			message: `确定要删除角色「${name}」？`,
		});
		if (!ok) return;
		try {
			await deleteRole(id);
			toast.success("角色已删除");
			loadRoles();
		} catch (e: unknown) {
			toast.apiError(e, "删除失败");
		}
	};

	return (
		<div className="space-y-6">
				<PageHeader
					title="角色管理"
					subtitle="管理用户角色与权限"
					actions={
						<>
							<ExportButton endpoint="/admin/roles/export" filename="角色列表" />
							<Button
								onClick={() => {
									form.reset();
									setShowCreate(true);
								}}
							>
								<Plus size={16} /> 新建角色
							</Button>
						</>
					}
				/>

				<div className="flex items-center gap-3 mb-4">
					<div className="flex-1 max-w-xs">
						<SearchInput
							value={searchInput}
							onChange={handleSearchChange}
							placeholder="搜索角色..."
						/>
					</div>
				</div>

				<div className="space-y-3">
					{loading && roles.length === 0 ? (
						<LoadingSkeleton variant="table" />
					) : roles.length === 0 ? (
						<EmptyState
							icon={Shield}
							title="暂无角色"
							description="创建第一个角色后这里会显示"
						/>
					) : (
						roles.map((role) => (
							<div key={role.id} className="rounded-xl border bg-card p-4">
								<div className="flex items-center justify-between mb-2">
									<div>
										<span className="font-semibold">{role.display_name}</span>
										<code className="ml-2 text-xs text-muted-foreground">
											{role.name}
										</code>
										{role.is_system && (
											<span className="ml-2 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
												系统
											</span>
										)}
										<span className="ml-2 text-xs text-muted-foreground">
											{role.user_count} 用户
										</span>
									</div>
									<div className="flex gap-2">
										{editId === role.id ? (
											<>
												<Button
													size="sm"
													variant="outline"
													onClick={() => saveEdit(role.id)}
												>
													<Save size={14} /> 保存
												</Button>
												<Button
													size="sm"
													variant="ghost"
													onClick={() => setEditId(null)}
												>
													<X size={14} />
												</Button>
											</>
										) : (
											<>
												<Button
													size="sm"
													variant="outline"
													onClick={() => startEdit(role)}
												>
													编辑权限
												</Button>
												{!role.is_system && (
													<Button
														size="sm"
														variant="ghost"
														className="text-destructive"
														onClick={() => handleDelete(role.id, role.name)}
													>
														<Trash2 size={14} />
													</Button>
												)}
											</>
										)}
									</div>
								</div>
								{editId === role.id ? (
									<div className="grid grid-cols-3 gap-2 mt-3">
										{ALL_PERMISSIONS.map((p) => (
											<label
												key={p.key}
												className="flex items-center gap-1.5 text-sm cursor-pointer"
											>
												<input
													type="checkbox"
													checked={editPerms.includes(p.key)}
													onChange={() => togglePerm(p.key)}
													className="size-4"
												/>
												{p.label}
											</label>
										))}
									</div>
								) : (
									<div className="flex flex-wrap gap-1">
										{role.permissions.length === 0 && (
											<span className="text-xs text-muted-foreground">
												无权限
											</span>
										)}
										{(role.permissions ?? []).map((p) => (
											<span
												key={p}
												className="text-xs bg-muted px-1.5 py-0.5 rounded"
											>
												{ALL_PERMISSIONS.find((ap) => ap.key === p)?.label || p}
											</span>
										))}
									</div>
								)}
							</div>
						))
					)}
				</div>

				<Dialog
					open={showCreate}
					onOpenChange={(o) => {
						if (!o) {
							form.reset();
							setShowCreate(false);
						}
					}}
				>
					<DialogContent title="新建角色" maxWidth={560}>
						<Form {...form}>
							<form
								onSubmit={form.handleSubmit(onSubmit)}
								className="space-y-4 py-2"
							>
								<FormField
									control={form.control}
									name="name"
									render={({ field }) => (
										<FormItem>
											<FormLabel>角色标识</FormLabel>
											<FormControl>
												<Input
													placeholder="英文标识，如：intern_teacher"
													{...field}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<FormField
									control={form.control}
									name="displayName"
									render={({ field }) => (
										<FormItem>
											<FormLabel>显示名称</FormLabel>
											<FormControl>
												<Input placeholder="如：见习教师" {...field} />
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
											form.reset();
											setShowCreate(false);
										}}
									>
										取消
									</Button>
									<Button
										type="submit"
										disabled={form.formState.isSubmitting}
									>
										{form.formState.isSubmitting ? "创建中..." : "创建角色"}
									</Button>
								</DialogFooter>
							</form>
						</Form>
					</DialogContent>
				</Dialog>
			</div>
	);
}
