import { useQueryClient } from "@tanstack/react-query";
import { Button, Center, Group, Loader, Modal, Paper, Select, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";
import { IconPlus, IconUsers } from "@tabler/icons-react";
import { useCallback, useRef, useState } from "react";
import { removeClassMembers } from "@/api";
import { bulkAssignClass, updateUser } from "@/api/admin/users";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import ClassFilter, { type ClassFilterParams } from "@/components/admin/ClassFilter";
import BatchActionBar from "@/components/admin/users/BatchActionBar";
import UserCard from "@/components/admin/users/UserCard";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";

import EmptyState from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import Pagination from "@/components/ui/pagination";
import { useClassesQuery } from "@/hooks/useClasses";
import BatchImport from "./users/BatchImport";
import type {
	BatchUser,
	EditUserFormValues,
	MembershipDraft,
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

const MEMBER_ROLE_DATA = [
	{ value: "student", label: "学生" },
	{ value: "teacher", label: "教师" },
];

/** 表单草稿 → 后端 memberships 全量替换载荷（丢弃空行与重复班级）。 */
function toMembershipUpdates(
	drafts: MembershipDraft[],
): Schemas["UserMembershipUpdate"][] {
	const seen = new Set<number>();
	const items: Schemas["UserMembershipUpdate"][] = [];
	for (const draft of drafts) {
		if (!draft.class_id) continue;
		const classId = Number(draft.class_id);
		if (seen.has(classId)) continue;
		seen.add(classId);
		items.push({ class_id: classId, member_role: draft.member_role });
	}
	return items;
}

function classLabel(classId: string, classes: Schemas["ClassResponse"][]): string {
	const found = classes.find((c) => String(c.id) === classId);
	if (!found) return classId;
	return found.cohort_label ? `${found.cohort_label} ${found.name}` : found.name;
}

interface UsersTabProps {
	currentUserId?: number;
}

export default function UsersTab({ currentUserId }: UsersTabProps) {
	const LIMIT = 50;
	const [offset, setOffset] = useState(0);
	const [search, setSearch] = useState("");
	const [roleFilter, setRoleFilter] = useState("");
	const [classParam, setClassParam] = useState<ClassFilterParams | null>(null);
	const [showUserForm, setShowUserForm] = useState(false);
	const [editingUser, setEditingUser] = useState<UserBrief | null>(null);
	const [showBatchImport, setShowBatchImport] = useState(false);
	const [regMsg, setRegMsg] = useState("");
	const [editUserMsg, setEditUserMsg] = useState("");
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
	const [addDialog, setAddDialog] = useState<{
		open: boolean;
		classId: string;
		memberRole: "student" | "teacher";
	}>({ open: false, classId: "", memberRole: "student" });
	const [removeDialog, setRemoveDialog] = useState<{ open: boolean; classId: string }>({
		open: false,
		classId: "",
	});
	const [isBulkBusy, setIsBulkBusy] = useState(false);
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
	const { data: classes = [] } = useClassesQuery();

	const params: Record<string, unknown> = { limit: LIMIT };
	if (search) params.search = search;
	if (roleFilter) params.role = roleFilter;
	if (classParam?.class_id) params.class_id = classParam.class_id;
	else if (classParam?.cohort_label) params.cohort_label = classParam.cohort_label;

	const { data: userData, isLoading } = useUserList(offset, params);
	const { data: roles = [] } = useRolesQuery();

	const registerMutation = useRegisterMutation();
	const updateMutation = useUpdateUserMutation();
	const deleteMutation = useDeleteUserMutation();
	const batchImportMutation = useBatchCreateUsersMutation();

	const users = userData?.items ?? [];
	const total = userData?.total ?? 0;

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

	const openAddDialog = () =>
		setAddDialog({ open: true, classId: "", memberRole: "student" });
	const openRemoveDialog = () => setRemoveDialog({ open: true, classId: "" });

	const handleAddConfirm = async () => {
		if (!addDialog.classId) return;
		const label = classLabel(addDialog.classId, classes);
		const roleLabel = addDialog.memberRole === "teacher" ? "教师" : "学生";
		const ok = await confirm({
			title: "添加到班级",
			message: `将选中的 ${selectedIds.size} 名用户以「${roleLabel}」身份加入「${label}」？\n\n已在该班的成员保持原角色不变，除非角色不同（会按本次选择更新）。`,
		});
		if (!ok) return;
		setIsBulkBusy(true);
		try {
			const { data } = await bulkAssignClass(
				[...selectedIds],
				Number(addDialog.classId),
				addDialog.memberRole,
			);
			const parts = [`新增 ${data.assigned} 人`];
			if (data.updated > 0) parts.push(`更新角色 ${data.updated} 人`);
			if (data.skipped > 0) parts.push(`跳过 ${data.skipped} 人`);
			toast.success(parts.join("，"));
			if (data.errors.length > 0) {
				toast.warning(`部分失败：${data.errors.slice(0, 3).join("；")}`);
			}
			queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all });
			queryClient.invalidateQueries({ queryKey: queryKeys.classes.all });
			setSelectedIds(new Set());
			setAddDialog({ open: false, classId: "", memberRole: "student" });
			resetToFirstPage();
		} catch (e: unknown) {
			toast.apiError(e, "添加失败");
		} finally {
			setIsBulkBusy(false);
		}
	};

	const handleRemoveConfirm = async () => {
		if (!removeDialog.classId) return;
		const label = classLabel(removeDialog.classId, classes);
		const ok = await confirm({
			title: "从班级移除",
			message: `将选中的 ${selectedIds.size} 名用户从「${label}」移除？\n\n他们在其他班级的归属不受影响。`,
			confirmLabel: "确定移除",
			danger: true,
		});
		if (!ok) return;
		setIsBulkBusy(true);
		try {
			const { data } = await removeClassMembers(
				Number(removeDialog.classId),
				[...selectedIds],
			);
			const parts = [`已移除 ${data.removed} 人`];
			if (data.skipped > 0) parts.push(`未在该班 ${data.skipped} 人`);
			toast.success(parts.join("，"));
			if ((data.errors ?? []).length > 0) {
				toast.warning(`部分失败：${(data.errors ?? []).slice(0, 3).join("；")}`);
			}
			queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all });
			queryClient.invalidateQueries({ queryKey: queryKeys.classes.all });
			setSelectedIds(new Set());
			setRemoveDialog({ open: false, classId: "" });
			resetToFirstPage();
		} catch (e: unknown) {
			toast.apiError(e, "移除失败");
		} finally {
			setIsBulkBusy(false);
		}
	};

	const handleBulkResetPasswordClick = () => {
		setBulkPassword("");
		setShowBulkResetDialog(true);
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
		};
		registerMutation.mutate(
			{ payload, memberships: toMembershipUpdates(form.memberships) },
			{
				onSuccess: () => {
					resetToFirstPage();
					closeUserForm();
				},
				onError: (err: unknown) => {
					const e = err as { response?: { data?: { detail?: string } } };
					setRegMsg(e.response?.data?.detail || "注册失败");
				},
			},
		);
	};

	const handleSaveEdit = (form: EditUserFormValues) => {
		const payload: Schemas["UserUpdateRequest"] = {
			memberships: toMembershipUpdates(form.memberships),
		};
		if (form.display_name) payload.display_name = form.display_name;
		payload.student_id = form.student_id || null;
		if (form.role) payload.role = form.role;
		if (form.password) payload.password = form.password;
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

	const handleBatchImport = (usersToImport: BatchUser[]) => {
		batchImportMutation.mutate(usersToImport);
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

			<Paper p="md">
				<Group gap={8} mb="md" wrap="wrap">
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
						onChange={(next) => {
							setClassParam(next);
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
				onAddToClass={openAddDialog}
				onRemoveFromClass={openRemoveDialog}
				onBulkResetPassword={handleBulkResetPasswordClick}
			/>

			<UserForm
				open={showUserForm && editingUser === null}
				user={null}
				roles={roles}
				classes={classes}
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
				classes={classes}
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
				classes={classes}
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
							<Group gap={8} p="md" bg="var(--mantine-color-default-hover)" wrap="nowrap" style={{ borderRadius: "var(--mantine-radius-md)" }}>
								<Text ff="monospace" fw={700} size="lg" style={{ flex: 1, userSelect: "all" }}>
									{resetPasswordDialog.password}
								</Text>
								<Button
									variant="subtle"
									size="xs"
									color="blue"
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

			<Modal
				opened={addDialog.open}
				onClose={() => setAddDialog((d) => ({ ...d, open: false }))}
				title="添加到班级"
				size={420}
				centered
				withinPortal
			>
					<Stack gap="md">
						<Text size="sm" c="dimmed">
							为已选的 {selectedIds.size} 名用户添加班级归属：
						</Text>
						<Select
							label="班级" withAsterisk
							value={addDialog.classId || null}
							onChange={(v) => setAddDialog((d) => ({ ...d, classId: v ?? "" }))}
							data={classes.map((c) => ({
								value: String(c.id),
								label: c.cohort_label ? `${c.cohort_label} ${c.name}` : c.name,
							}))}
							placeholder="选择班级…"
							searchable
						/>
						<Select
							label="身份"
							value={addDialog.memberRole}
							onChange={(v) =>
								setAddDialog((d) => ({
									...d,
									memberRole: (v as "student" | "teacher") ?? "student",
								}))
							}
							data={MEMBER_ROLE_DATA}
							allowDeselect={false}
						/>
						<Text size="xs" c="dimmed">
							已在班级中的成员会沿用原角色；若角色不同则按本次选择更新，角色冲突不会静默覆盖。
						</Text>
					</Stack>
					<Group justify="flex-end" gap={8} mt="md">
						<Button
							variant="outline"
							onClick={() => setAddDialog((d) => ({ ...d, open: false }))}
						>
							取消
						</Button>
						<Button
							disabled={!addDialog.classId || isBulkBusy}
							onClick={handleAddConfirm}
						>
							{isBulkBusy ? "处理中…" : "确认添加"}
						</Button>
					</Group>
			</Modal>

			<Modal
				opened={removeDialog.open}
				onClose={() => setRemoveDialog((d) => ({ ...d, open: false }))}
				title="从班级移除"
				size={420}
				centered
				withinPortal
			>
					<Stack gap="md">
						<Text size="sm" c="dimmed">
							将已选的 {selectedIds.size} 名用户从以下班级移除（其他班级归属不受影响）：
						</Text>
						<Select
							label="班级" withAsterisk
							value={removeDialog.classId || null}
							onChange={(v) => setRemoveDialog((d) => ({ ...d, classId: v ?? "" }))}
							data={classes.map((c) => ({
								value: String(c.id),
								label: c.cohort_label ? `${c.cohort_label} ${c.name}` : c.name,
							}))}
							placeholder="选择班级…"
							searchable
						/>
					</Stack>
					<Group justify="flex-end" gap={8} mt="md">
						<Button
							variant="outline"
							onClick={() => setRemoveDialog((d) => ({ ...d, open: false }))}
						>
							取消
						</Button>
						<Button
							color="red"
							disabled={!removeDialog.classId || isBulkBusy}
							onClick={handleRemoveConfirm}
						>
							{isBulkBusy ? "处理中…" : "确认移除"}
						</Button>
					</Group>
			</Modal>

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
