import { useQueryClient } from "@tanstack/react-query";
import { Center, Group, Loader, Modal, Paper, Select, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";
import { IconPlus, IconUsers } from "@tabler/icons-react";
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
import Button from "@/components/ui/button";

import EmptyState from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import Pagination from "@/components/ui/pagination";
import { useClassesQuery, useGradesQuery } from "@/hooks/useGradesClasses";
import type { ClassItem } from "@/types/store";
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

	const openEditUser = async (u: UserBrief) => {
		if (showUserForm && editingUser === null && userFormDirtyRef.current) {
			const ok = await confirm({ title: "切换编辑用户", message: "注册表单内容未保存，确定切换？" });
			if (!ok) return;
		}
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
			<Group gap={12} wrap="wrap" mb="md">
				<Button leftSection={<IconPlus size={16} />} onClick={openCreateUser}>
					注册新用户
				</Button>
				<Button
					variant="outline"
					leftSection={<IconUsers size={16} />}
					onClick={() => setShowBatchImport(true)}
				>
					批量导入
				</Button>
			</Group>

			<Paper withBorder radius="lg" p="md" shadow="sm">
				<Group gap={8} mb="md">
					<SearchInput
						value={search}
						onChange={(v) => { setSearch(v); resetToFirstPage(); }}
						placeholder="搜索用户名、姓名或学号..."
					/>
					<Select
						value={roleFilter || null}
						onChange={(v) => {
							setRoleFilter(v ?? "");
							resetToFirstPage();
						}}
						data={[
							{ value: "", label: "全部角色" },
							...roles.map((r) => ({
								value: r.name,
								label: r.display_name,
							})),
						]}
						placeholder="全部角色"
						size="sm"
						clearable
					/>
					<ClassFilter
						onChange={(params) => {
							setClassParam(params);
							resetToFirstPage();
						}}
					/>
					<Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap" }}>
						共 {total} 人
					</Text>
				</Group>
				{isLoading && users.length === 0 ? (
					<Center py="xl">
						<Loader size="sm" />
					</Center>
				) : users.length === 0 ? (
					<EmptyState
						icon={IconUsers}
						title="暂无用户"
						description="注册第一个用户后这里会显示"
					/>
				) : (
					<>
						<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
							{users.map((u) => (
								<UserCard
									key={u.id}
									user={u}
									selected={selectedIds.has(u.id)}
									onSelect={handleToggleSelect}
									onClick={openEditUser}
								/>
							))}
						</SimpleGrid>
						<Pagination
							total={total}
							offset={offset}
							limit={LIMIT}
							onChange={setOffset}
						/>
					</>
				)}
			</Paper>

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
				<Modal
					opened
					onClose={() => setResetPasswordDialog(null)}
					title="密码已重置"
					size={400}
					centered
					withinPortal
				>
						<Stack gap="md">
							<Text size="sm" c="dimmed">
								用户{" "}
								<Text component="span" fw={700} c="inherit">
									{resetPasswordDialog.user.display_name}
								</Text>{" "}
								的密码已重置，请妥善保存：
							</Text>
							<Group gap={8} p="md" bg="var(--mantine-color-gray-1)" wrap="nowrap" style={{ borderRadius: "var(--mantine-radius-md)" }}>
								<Text ff="monospace" fw={700} size="lg" style={{ flex: 1, userSelect: "all" }}>
									{resetPasswordDialog.password}
								</Text>
								<Button
									variant="ghost"
									size="xs"
									color="teal"
									onClick={() => {
										navigator.clipboard.writeText(
											resetPasswordDialog.password,
										);
									}}
								>
									复制
								</Button>
							</Group>
							<Text size="xs" c="red">
								此密码仅展示一次，请立即告知用户并建议其登录后修改
							</Text>
						</Stack>
						<Group justify="flex-end" mt="md">
							<Button
								onClick={() => setResetPasswordDialog(null)}
							>
								知道了
							</Button>
						</Group>
				</Modal>
			)}

			{showBulkAssignDialog && (
				<Modal
					opened
					onClose={() => setShowBulkAssignDialog(false)}
					title="批量分配班级"
					size={400}
					centered
					withinPortal
				>
						<Stack gap="md">
							<Text size="sm" c="dimmed">
								为已选的 {selectedIds.size} 名用户分配班级：
							</Text>
							<Select
								value={bulkAssignClassId || null}
								onChange={(v) => setBulkAssignClassId(v ?? "")}
								data={classes.map((c) => ({
									value: String(c.id),
									label: `${c.grade_name} ${c.name}`,
								}))}
								placeholder="选择班级…"
							/>
						</Stack>
						<Group justify="flex-end" gap={8} mt="md">
							<Button
								variant="outline"
								onClick={() => setShowBulkAssignDialog(false)}
							>
								取消
							</Button>
							<Button
								disabled={!bulkAssignClassId || assigning}
								onClick={handleBulkAssignConfirm}
							>
								{assigning ? "分配中…" : "确认分配"}
							</Button>
						</Group>
				</Modal>
			)}

			{showBulkResetDialog && (
				<Modal
					opened
					onClose={() => setShowBulkResetDialog(false)}
					title="批量重置密码"
					size={400}
					centered
					withinPortal
				>
						<Stack gap="md">
							<Text size="sm" c="dimmed">
								为已选的 {selectedIds.size} 名用户设置新密码：
							</Text>
							<TextInput
								placeholder="输入新密码"
								value={bulkPassword}
								onChange={(e) => setBulkPassword(e.currentTarget.value)}
							/>
						</Stack>
						<Group justify="flex-end" gap={8} mt="md">
							<Button
								variant="outline"
								onClick={() => setShowBulkResetDialog(false)}
							>
								取消
							</Button>
							<Button
								disabled={!bulkPassword.trim()}
								onClick={handleBulkResetConfirm}
							>
								确认重置
							</Button>
						</Group>
				</Modal>
			)}
		</>
	);
}
