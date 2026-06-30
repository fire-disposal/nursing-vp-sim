import { Plus, Users } from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { getClasses } from "@/api/api-client";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
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

	const { confirm } = useConfirm();
	const toast = useToast();
	const { grades, fetchGrades } = useGradesClassesStore(
		useShallow((s) => ({ grades: s.grades, fetchGrades: s.fetchGrades })),
	);

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
		batchImportMutation.mutate(users, {
			onSuccess: () => {
				resetToFirstPage();
				setShowBatchImport(false);
			},
		});
	};

	return (
		<>
			<div className="mb-4 flex gap-3">
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

			<UserList
				users={users}
				loading={isLoading}
				total={total}
				offset={offset}
				limit={LIMIT}
				roles={roles}
				search={search}
				roleFilter={roleFilter}
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
		</>
	);
}
