import { useQueryClient } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import { useCallback, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { getClasses } from "@/api";
import { bulkAssignClass, updateUser } from "@/api/admin/users";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import useGradesClassesStore from "@/stores/gradesClassesStore";
import type { ClassItem } from "@/types/store";
import { btnPrimary, btnSecondary } from "@/utils/styles";
import BatchImport from "./users/BatchImport";
import type {
	BatchUser,
	EditUserFormValues,
	UserBrief,
	UserFormValues,
} from "./users/types";
import UserForm from "./users/UserForm";
import UserList from "./users/UserList";
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
	const [assignClassId, setAssignClassId] = useState<string>("");
	const [assigning, setAssigning] = useState(false);
	const [resetPasswordDialog, setResetPasswordDialog] = useState<{
		user: UserBrief;
		password: string;
	} | null>(null);

	const { confirm } = useConfirm();
	const toast = useToast();
	const queryClient = useQueryClient();
	const { grades, fetchGrades } = useGradesClassesStore(
		useShallow((s) => ({ grades: s.grades, fetchGrades: s.fetchGrades })),
	);
	const classes = useGradesClassesStore((s) => s.classes);
	const fetchClasses = useGradesClassesStore((s) => s.fetchClasses);

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

	const toggleSelect = useCallback((userId: number) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(userId)) next.delete(userId);
			else next.add(userId);
			return next;
		});
	}, []);

	const selectAll = useCallback(() => {
		setSelectedIds(new Set(users.map((u) => u.id)));
		setAssignClassId("");
	}, [users]);

	const deselectAll = useCallback(() => {
		setSelectedIds(new Set());
		setAssignClassId("");
	}, []);

	const handleBulkAssign = async () => {
		if (!assignClassId) return;
		const ok = await confirm({
			title: "批量分配班级",
			message: `确定将 ${selectedIds.size} 名用户分配到所选班级吗？`,
		});
		if (!ok) return;
		setAssigning(true);
		try {
			const { data } = await bulkAssignClass(
				[...selectedIds],
				Number(assignClassId),
			);
			toast.success(`已分配 ${data.assigned} 名用户`);
			if (data.errors.length > 0) {
				toast.warning(`部分失败: ${data.errors.join(", ")}`);
			}
			queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all });
			setSelectedIds(new Set());
			setAssignClassId("");
			resetToFirstPage();
		} catch (e: unknown) {
			toast.apiError(e, "分配失败");
		} finally {
			setAssigning(false);
		}
	};

	const openCreateUser = () => {
		fetchGrades();
		setEditingUser(null);
		setRegMsg("");
		setShowUserForm(true);
	};

	const openEditUser = (u: UserBrief) => {
		fetchGrades();
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
		else if (form.class_id === "") payload.class_id = 0;
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

	const handleDeleteUser = async (u: UserBrief) => {
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
				{selectedIds.size > 0 && (
					<div className="flex items-center gap-2 ml-auto">
						<span className="text-sm text-muted-foreground font-medium">
							已选 {selectedIds.size} 人
						</span>
						<button className={btnSecondary} onClick={deselectAll}>
							取消选择
						</button>
						<select
							value={assignClassId}
							onChange={(e) => setAssignClassId(e.target.value)}
							className="py-1.5 px-2.5 border border-border rounded-lg text-sm bg-card"
							onFocus={() => fetchClasses()}
						>
							<option value="">分配至班级…</option>
							{classes.map((c) => (
								<option key={c.id} value={c.id}>
									{c.grade_name} {c.name}
								</option>
							))}
						</select>
						<button
							className={btnPrimary}
							disabled={!assignClassId || assigning}
							onClick={handleBulkAssign}
						>
							{assigning ? "分配中…" : "确认分配"}
						</button>
					</div>
				)}
			</div>

			<UserList
				users={users}
				loading={isLoading}
				total={total}
				offset={offset}
				limit={LIMIT}
				roles={roles}
				search={search}
				roleFilter={roleFilter}
				selectedIds={selectedIds}
				onSearchChange={(v) => {
					setSearch(v);
					resetToFirstPage();
				}}
				onRoleFilterChange={(v) => {
					setRoleFilter(v);
					resetToFirstPage();
				}}
				onClassFilterChange={(params) => {
					setClassParam(params);
					resetToFirstPage();
				}}
				onOffsetChange={setOffset}
				onEditUser={openEditUser}
				onDeleteUser={handleDeleteUser}
				onToggleSelect={toggleSelect}
				onSelectAll={selectAll}
				onDeselectAll={deselectAll}
			/>

			<UserForm
				open={showUserForm && editingUser === null}
				user={null}
				roles={roles}
				grades={grades}
				getClassesForGrade={getClassesForGrade}
				onClose={closeUserForm}
				onSaveRegister={handleSaveRegister}
				onSaveEdit={handleSaveEdit}
				onResetPassword={handleResetPassword}
				registerMsg={regMsg}
				editUserMsg=""
				isSaving={registerMutation.isPending}
			/>

			<UserForm
				open={showUserForm && editingUser !== null}
				user={editingUser}
				roles={roles}
				grades={grades}
				getClassesForGrade={getClassesForGrade}
				onClose={closeUserForm}
				onSaveRegister={handleSaveRegister}
				onSaveEdit={handleSaveEdit}
				onResetPassword={handleResetPassword}
				registerMsg=""
				editUserMsg={editUserMsg}
				isSaving={updateMutation.isPending}
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
		</>
	);
}
