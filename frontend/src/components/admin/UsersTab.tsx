import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Search, Users } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { getClasses } from "@/api";
import { bulkAssignClass, updateUser } from "@/api/admin/users";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import ClassFilter from "@/components/admin/ClassFilter";
import BatchActionBar from "@/components/admin/users/BatchActionBar";
import UserCard from "@/components/admin/users/UserCard";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import EmptyState from "@/components/ui/empty-state";
import Pagination from "@/components/ui/pagination";
import { useClassesQuery, useGradesQuery } from "@/hooks/useGradesClasses";
import type { ClassItem } from "@/types/store";
import { btnPrimary, btnSecondary, selectClass } from "@/utils/styles";
import BatchImport from "./users/BatchImport";
import type {
	BatchUser,
	EditUserFormValues,
	UserBrief,
	UserFormValues,
} from "./users/types";
import UserForm from "./users/UserForm";
import { useRolesQuery, useUserList } from "./users/useUserList";
import {
	useBatchCreateUsersMutation,
	useDeleteUserMutation,
	useRegisterMutation,
	useUpdateUserMutation,
} from "./users/useUserMutations";

type Schemas = components["schemas"];


interface UsersTabProps {
	currentUserId?: number;
}

export default function UsersTab({ currentUserId }: UsersTabProps) {
	const LIMIT = 50;
	const [offset, setOffset] = useState(0);
	const [search, setSearch] = useState("");
	const [roleFilter, setRoleFilter] = useState("");
	const [classParam, setClassParam] = useState<{
		grade_id: number | null;
		class_id: number | null;
	} | null>(null);
	const [showUserForm, setShowUserForm] = useState(false);
	const [editingUser, setEditingUser] = useState<UserBrief | null>(null);
	const [showBatchImport, setShowBatchImport] = useState(false);
	const [regMsg, setRegMsg] = useState("");
	const [editUserMsg, setEditUserMsg] = useState("");
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
	const [showBulkAssignDialog, setShowBulkAssignDialog] = useState(false);
	const [bulkAssignClassId, setBulkAssignClassId] = useState<string>("");
	const [assigning, setAssigning] = useState(false);
	const [showBulkResetDialog, setShowBulkResetDialog] = useState(false);
	const [bulkPassword, setBulkPassword] = useState("");
	const [resetPasswordDialog, setResetPasswordDialog] = useState<{
		user: UserBrief;
		password: string;
	} | null>(null);

	const { confirm } = useConfirm();
	const toast = useToast();
	const queryClient = useQueryClient();
	const userFormDirtyRef = useRef(false);
	const { data: grades = [] } = useGradesQuery();
	const { data: classes = [] } = useClassesQuery();

	const params: Record<string, unknown> = { limit: LIMIT };
	if (search) params.search = search;
	if (roleFilter) params.role = roleFilter;
	if (classParam?.class_id) params.class_id = classParam.class_id;
	else if (classParam?.grade_id) params.grade_id = classParam.grade_id;

	const { data: userData, isLoading } = useUserList(offset, params);
	const { data: roles = [] } = useRolesQuery();

	const registerMutation = useRegisterMutation();
	const updateMutation = useUpdateUserMutation();
	const deleteMutation = useDeleteUserMutation();
	const batchImportMutation = useBatchCreateUsersMutation();

	const users = userData?.items ?? [];
	const total = userData?.total ?? 0;

	const getClassesForGrade = async (gradeId: string): Promise<ClassItem[]> => {
		if (!gradeId) return [];
		try {
			const { data } = await getClasses({ grade_id: gradeId });
			return data;
		} catch {
			return [];
		}
	};

	const resetToFirstPage = () => setOffset(0);

	const deselectAll = useCallback(() => {
		setSelectedIds(new Set());
	}, []);

	const handleToggleSelect = (id: number, checked: boolean) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (checked) next.add(id);
			else next.delete(id);
			return next;
		});
	};

	const handleBulkAssignClick = () => {
		setShowBulkAssignDialog(true);
	};

	const handleBulkResetPasswordClick = () => {
		setBulkPassword("");
		setShowBulkResetDialog(true);
	};

	const handleBulkAssignConfirm = async () => {
		if (!bulkAssignClassId) return;
		const ok = await confirm({
			title: "批量分配班级",
			message: `确定将 ${selectedIds.size} 名用户分配到所选班级吗？`,
		});
		if (!ok) return;
		setAssigning(true);
		try {
			const { data } = await bulkAssignClass(
				[...selectedIds],
				Number(bulkAssignClassId),
			);
			toast.success(`已分配 ${data.assigned} 名用户`);
			if (data.errors.length > 0) {
				toast.warning(`部分失败: ${data.errors.join(", ")}`);
			}
			queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all });
			setSelectedIds(new Set());
			setShowBulkAssignDialog(false);
			resetToFirstPage();
		} catch (e: unknown) {
			toast.apiError(e, "分配失败");
		} finally {
			setAssigning(false);
		}
	};

	const handleBulkResetConfirm = async () => {
		if (!bulkPassword?.trim()) return;
		const ok = await confirm({
			title: "批量重置密码",
			message: `确定要为 ${selectedIds.size} 名用户重置密码吗？\n\n新密码：${bulkPassword}`,
		});
		if (!ok) return;
		let success = 0;
		let failed = 0;
		for (const id of selectedIds) {
			try {
				await updateUser(id, { password: bulkPassword } as Schemas["UserUpdateRequest"]);
				success++;
			} catch {
				failed++;
			}
		}
		toast.success(`密码重置完成：成功 ${success} 人${failed > 0 ? `，失败 ${failed} 人` : ""}`);
		queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all });
		setSelectedIds(new Set());
		setShowBulkResetDialog(false);
	};

	const openCreateUser = () => {
		setEditingUser(null);
		setRegMsg("");
		setShowUserForm(true);
	};

	const openEditUser = (u: UserBrief) => {
		if (showUserForm && editingUser === null && userFormDirtyRef.current && !window.confirm("注册表单内容未保存，确定切换？")) return;
		setEditingUser(u);
		setEditUserMsg("");
		setShowUserForm(true);
	};

	const closeUserForm = () => {
		setShowUserForm(false);
		setEditingUser(null);
		setRegMsg("");
		setEditUserMsg("");
	};

	const handleSaveRegister = (form: UserFormValues) => {
		const payload: Schemas["RegisterRequest"] = {
			username: form.username,
			password: form.password,
			role: form.role,
			display_name: form.display_name,
			student_id: form.student_id || null,
			class_id: form.class_id ? Number(form.class_id) : undefined,
		};
		registerMutation.mutate(payload, {
			onSuccess: () => {
				resetToFirstPage();
				closeUserForm();
			},
			onError: (err: unknown) => {
				const e = err as { response?: { data?: { detail?: string } } };
				setRegMsg(e.response?.data?.detail || "注册失败");
			},
		});
	};

	const handleSaveEdit = (form: EditUserFormValues) => {
		const payload: Record<string, unknown> = {};
		if (form.display_name) payload.display_name = form.display_name;
		if (form.student_id) payload.student_id = form.student_id;
		else payload.student_id = null;
		if (form.role) payload.role = form.role;
		if (form.password) payload.password = form.password;
		if (form.class_id !== undefined && form.class_id !== "")
			payload.class_id = Number(form.class_id);
		else payload.class_id = null;
		updateMutation.mutate(
			{ id: editingUser!.id, data: payload },
			{
				onSuccess: () => {
					resetToFirstPage();
					closeUserForm();
				},
				onError: (err: unknown) => {
					const e = err as { response?: { data?: { detail?: string } } };
					setEditUserMsg(e.response?.data?.detail || "保存失败");
				},
			},
		);
	};

	const _handleDeleteUser = async (u: UserBrief) => {
		if (u.id === currentUserId) {
			toast.warning("不能删除自己的账号");
			return;
		}
		const ok = await confirm({
			title: "删除用户",
			message: `确定删除用户"${u.display_name}"(${u.username})吗？此操作不可恢复。`,
			confirmLabel: "确定删除",
			danger: true,
		});
		if (!ok) return;
		deleteMutation.mutate(u.id, {
			onSuccess: () => {
				resetToFirstPage();
			},
		});
	};

	const handleBatchImport = (users: BatchUser[]) => {
		batchImportMutation.mutate(users);
	};

	const handleResetPassword = async (password: string) => {
		if (!editingUser) return;
		const ok = await confirm({
			title: "重置密码",
			message: `确定要为用户「${editingUser.display_name}」重置密码吗？\n\n新密码：${password}`,
		});
		if (!ok) return;
		try {
			await updateUser(editingUser.id, { password } as Schemas["UserUpdateRequest"]);
			queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all });
			toast.success("密码已重置");
			closeUserForm();
			setResetPasswordDialog({ user: editingUser, password });
		} catch (err) {
			toast.apiError(err, "密码重置失败");
			throw err;
		}
	};

	return (
		<>
			<div className="mb-4 flex gap-3 flex-wrap items-center">
				<button type="button" className={btnPrimary} onClick={openCreateUser}>
					<Plus size={16} /> 注册新用户
				</button>
				<button
					className={btnSecondary}
					onClick={() => setShowBatchImport(true)}
				>
					<Users size={16} /> 批量导入
				</button>
			</div>

			<div className="rounded-xl border border-border bg-card shadow-sm p-6">
				<div className="mb-3 flex gap-2 items-center">
					<div className="relative flex-1 max-w-[320px]">
						<Search
							size={14}
							className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70"
						/>
						<input
							type="text"
							placeholder="搜索用户名、姓名或学号..."
						aria-label="搜索用户名、姓名或学号"
							value={search}
							onChange={(e) => {
								setSearch(e.target.value);
								resetToFirstPage();
							}}
							className="w-full py-1.5 pl-[30px] pr-2.5 border border-border rounded-lg text-sm"
						/>
					</div>
					<select
						value={roleFilter}
						onChange={(e) => {
							setRoleFilter(e.target.value);
							resetToFirstPage();
						}}
						className={selectClass}
					>
						<option value="">全部角色</option>
						{roles.map((r) => (
							<option key={r.name} value={r.name}>
								{r.display_name}
							</option>
						))}
					</select>
					<ClassFilter
						onChange={(params) => {
							setClassParam(params);
							resetToFirstPage();
						}}
					/>
					<span className="text-sm text-muted-foreground whitespace-nowrap">
						共 {total} 人
					</span>
				</div>
				{isLoading && users.length === 0 ? (
					<div className="flex justify-center py-12">
						<Loader2 size={24} className="animate-spin text-muted-foreground" />
					</div>
				) : users.length === 0 ? (
					<EmptyState
						icon={Users}
						title="暂无用户"
						description="注册第一个用户后这里会显示"
					/>
				) : (
					<>
						<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
							{users.map((u) => (
								<UserCard
									key={u.id}
									user={u}
									selected={selectedIds.has(u.id)}
									onSelect={handleToggleSelect}
									onClick={openEditUser}
								/>
							))}
						</div>
						<Pagination
							total={total}
							offset={offset}
							limit={LIMIT}
							onChange={setOffset}
						/>
					</>
				)}
			</div>

			<BatchActionBar
				selectedCount={selectedIds.size}
				onClearSelection={deselectAll}
				onBulkAssignClass={handleBulkAssignClick}
				onBulkResetPassword={handleBulkResetPasswordClick}
			/>

			<UserForm
				open={showUserForm && editingUser === null}
				user={null}
				roles={roles}
				grades={grades}
				allClasses={classes}
				getClassesForGrade={getClassesForGrade}
				onClose={closeUserForm}
				onSaveRegister={handleSaveRegister}
				onSaveEdit={handleSaveEdit}
				onResetPassword={handleResetPassword}
				registerMsg={regMsg}
				editUserMsg=""
				isSaving={registerMutation.isPending}
				dirtyRef={userFormDirtyRef}
			/>

			<UserForm
				open={showUserForm && editingUser !== null}
				user={editingUser}
				roles={roles}
				grades={grades}
				allClasses={classes}
				getClassesForGrade={getClassesForGrade}
				onClose={closeUserForm}
				onSaveRegister={handleSaveRegister}
				onSaveEdit={handleSaveEdit}
				onResetPassword={handleResetPassword}
				registerMsg=""
				editUserMsg={editUserMsg}
				isSaving={updateMutation.isPending}
				dirtyRef={userFormDirtyRef}
			/>

			<BatchImport
				open={showBatchImport}
				onClose={() => setShowBatchImport(false)}
				roles={roles}
				isImporting={batchImportMutation.isPending}
				onImport={handleBatchImport}
			/>

			{resetPasswordDialog && (
				<Dialog
					open
					onOpenChange={() => setResetPasswordDialog(null)}
				>
					<DialogContent title="密码已重置" maxWidth={400}>
						<div className="space-y-4">
							<p className="text-sm text-muted-foreground">
								用户{" "}
								<strong>{resetPasswordDialog.user.display_name}</strong>{" "}
								的密码已重置，请妥善保存：
							</p>
							<div className="flex items-center gap-2 rounded-lg border bg-muted p-3">
								<code className="flex-1 text-lg font-mono font-bold select-all">
									{resetPasswordDialog.password}
								</code>
								<button
									type="button"
									className="text-xs text-primary underline hover:no-underline shrink-0"
									onClick={() => {
										navigator.clipboard.writeText(
											resetPasswordDialog.password,
										);
									}}
								>
									复制
								</button>
							</div>
							<p className="text-xs text-destructive">
								此密码仅展示一次，请立即告知用户并建议其登录后修改
							</p>
						</div>
						<div className="flex justify-end mt-4">
							<button
								type="button"
								className={btnPrimary}
								onClick={() => setResetPasswordDialog(null)}
							>
								知道了
							</button>
						</div>
					</DialogContent>
				</Dialog>
			)}

			{showBulkAssignDialog && (
				<Dialog
					open
					onOpenChange={() => setShowBulkAssignDialog(false)}
				>
					<DialogContent title="批量分配班级" maxWidth={400}>
						<div className="space-y-4">
							<p className="text-sm text-muted-foreground">
								为已选的 {selectedIds.size} 名用户分配班级：
							</p>
							<select
								value={bulkAssignClassId}
								onChange={(e) => setBulkAssignClassId(e.target.value)}
								className="w-full py-2 px-3 border border-border rounded-lg text-sm bg-card"
							>
								<option value="">选择班级…</option>
								{classes.map((c) => (
									<option key={c.id} value={c.id}>
										{c.grade_name} {c.name}
									</option>
								))}
							</select>
						</div>
						<div className="flex justify-end gap-2 mt-4">
							<button
								type="button"
								className={btnSecondary}
								onClick={() => setShowBulkAssignDialog(false)}
							>
								取消
							</button>
							<button
								type="button"
								className={btnPrimary}
								disabled={!bulkAssignClassId || assigning}
								onClick={handleBulkAssignConfirm}
							>
								{assigning ? "分配中…" : "确认分配"}
							</button>
						</div>
					</DialogContent>
				</Dialog>
			)}

			{showBulkResetDialog && (
				<Dialog
					open
					onOpenChange={() => setShowBulkResetDialog(false)}
				>
					<DialogContent title="批量重置密码" maxWidth={400}>
						<div className="space-y-4">
							<p className="text-sm text-muted-foreground">
								为已选的 {selectedIds.size} 名用户设置新密码：
							</p>
							<input
								type="text"
								placeholder="输入新密码"
								value={bulkPassword}
								onChange={(e) => setBulkPassword(e.target.value)}
								className="w-full py-2 px-3 border border-border rounded-lg text-sm bg-card"
							/>
						</div>
						<div className="flex justify-end gap-2 mt-4">
							<button
								type="button"
								className={btnSecondary}
								onClick={() => setShowBulkResetDialog(false)}
							>
								取消
							</button>
							<button
								type="button"
								className={btnPrimary}
								disabled={!bulkPassword.trim()}
								onClick={handleBulkResetConfirm}
							>
								确认重置
							</button>
						</div>
					</DialogContent>
				</Dialog>
			)}
		</>
	);
}
