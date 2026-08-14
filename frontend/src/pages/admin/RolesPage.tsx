import { Badge, Box, Button, Code, Group, Modal, Paper, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { IconDeviceFloppy, IconPlus, IconShield, IconTrash, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { createRole, deleteRole, getRoles, updateRole } from "@/api/admin/roles";
import ExportButton from "@/components/ExportButton";
import { useToast } from "@/components/Toast";
import { Checkbox } from "@mantine/core";
import { useConfirm } from "@/components/ui/confirm";
import EmptyState from "@/components/ui/empty-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { PERMISSION_DEFS } from "@/config/permissions.gen";
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

export default function RolesPage() {
	const toast = useToast();
	const [roles, setRoles] = useState<RoleItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [editId, setEditId] = useState<number | null>(null);
	const [editPerms, setEditPerms] = useState<string[]>([]);
	const [editDisplayName, setEditDisplayName] = useState("");
	const [showCreate, setShowCreate] = useState(false);
	const { searchInput, debouncedValue: search, handleSearchChange } = useDebouncedSearch();
	const { confirm } = useConfirm();

	const form = useForm<RoleCreateValues>({
		initialValues: { name: "", displayName: "" },
		validate: schemaResolver(roleCreateSchema),
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

	const startEdit = async (role: RoleItem) => {
		if (editId !== null && editId !== role.id) {
			const ok = await confirm({
				title: "放弃修改？",
				message: "当前权限编辑尚未保存，确定放弃？",
				confirmLabel: "放弃",
				danger: true,
			});
			if (!ok) return;
		}
		setEditId(role.id);
		setEditPerms([...role.permissions]);
		setEditDisplayName(role.display_name);
	};

	const saveEdit = async (roleId: number) => {
		try {
			await updateRole(roleId, { display_name: editDisplayName || undefined, permissions: editPerms });
			toast.success("角色已保存");
			setEditId(null);
			loadRoles();
		} catch (e: unknown) {
			toast.apiError(e, "保存失败");
		}
	};

	const onSubmit = async (values: RoleCreateValues) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
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
		} finally {
			setIsSubmitting(false);
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
		<Stack gap="xl">
			<PageHeader
				title="角色管理"
				subtitle="管理用户角色与权限"
				actions={
					<Group gap="xs">
						<ExportButton endpoint="/admin/roles/export" filename="角色列表" />
						<Button
							onClick={() => {
								form.reset();
								setShowCreate(true);
							}}
						>
							<IconPlus size={16} /> 新建角色
						</Button>
					</Group>
				}
			/>

			<Group gap={12} mb="md">
				<Box maw={320} style={{ flex: 1 }}>
					<SearchInput
						value={searchInput}
						onChange={handleSearchChange}
						placeholder="搜索角色..."
						aria-label="搜索角色"
					/>
				</Box>
			</Group>

			<Stack gap="sm">
				{loading && roles.length === 0 ? (
					<LoadingSkeleton variant="table" />
				) : roles.length === 0 ? (
					<EmptyState
						icon={IconShield}
						title="暂无角色"
						description="创建第一个角色后这里会显示"
					/>
				) : (
					roles.map((role) => (
						<Paper key={role.id} withBorder radius="md" p="md">
							<Group justify="space-between" align="flex-start" wrap="wrap" mb={8}>
								<Group gap={8} align="center" wrap="wrap">
									<Text fw={600}>{role.display_name}</Text>
									<Code fz="xs">{role.name}</Code>
									{role.is_system && (
										<Badge variant="light" color="blue" size="xs">系统</Badge>
									)}
									<Text size="xs" c="dimmed">{role.user_count} 用户</Text>
								</Group>
								<Group gap={8}>
									{editId === role.id ? (
										<>
											<Button
												size="sm"
												variant="outline"
												onClick={() => saveEdit(role.id)}
											>
												<IconDeviceFloppy size={14} /> 保存
											</Button>
											<Button
												size="sm"
												variant="subtle" color="gray"
												onClick={() => setEditId(null)}
											>
												<IconX size={14} />
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
													variant="subtle"
													color="red"
													onClick={() => handleDelete(role.id, role.name)}
												>
													<IconTrash size={14} />
												</Button>
											)}
										</>
									)}
								</Group>
							</Group>
							{editId === role.id ? (
								<Stack gap="sm" mt="sm">
									<Group gap={8} align="center">
										<Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>显示名称</Text>
										<TextInput
											value={editDisplayName}
											onChange={(e) => setEditDisplayName(e.target.value)}
											placeholder={role.display_name}
											maw={192}
											size="xs"
										/>
									</Group>
									<SimpleGrid cols={3} spacing={8}>
										{PERMISSION_DEFS.map((p) => (
											<Checkbox
												key={p.key}
												label={p.label}
												checked={editPerms.includes(p.key)}
												onChange={() => togglePerm(p.key)}
											/>
										))}
									</SimpleGrid>
								</Stack>
							) : (
								<Group gap={4} wrap="wrap">
									{role.permissions.length === 0 && (
										<Text size="xs" c="dimmed">无权限</Text>
									)}
									{(role.permissions ?? []).map((p) => (
										<Badge key={p} variant="light" color="gray" size="xs">
											{PERMISSION_DEFS.find((ap) => ap.key === p)?.label || p}
										</Badge>
									))}
								</Group>
							)}
						</Paper>
					))
				)}
			</Stack>

			<Modal
				opened={showCreate}
				onClose={async () => {
					if (form.isDirty()) {
						const ok = await confirm({ title: "未保存的更改", message: "内容未保存，确定关闭？", danger: true });
						if (!ok) return;
					}
					form.reset();
					setShowCreate(false);
				}}
				title="新建角色"
				size={560}
				centered
				withinPortal
			>
					<form onSubmit={form.onSubmit(onSubmit)}>
						<Stack gap="md" py={8}>
							<TextInput
								label="角色标识"
								placeholder="英文标识，如：intern_teacher"
								{...form.getInputProps("name")}
							/>
							<TextInput
								label="显示名称"
								placeholder="如：见习教师"
								{...form.getInputProps("displayName")}
							/>
							<Group justify="flex-end" mt="lg" gap="sm">
								<Button
									type="button"
									variant="outline"
									onClick={async () => {
										if (form.isDirty()) {
											const ok = await confirm({ title: "未保存的更改", message: "内容未保存，确定关闭？", danger: true });
											if (!ok) return;
										}
										form.reset();
										setShowCreate(false);
									}}
								>
									取消
								</Button>
								<Button
									type="submit"
									disabled={isSubmitting}
								>
									{isSubmitting ? "创建中..." : "创建角色"}
								</Button>
							</Group>
						</Stack>
					</form>
			</Modal>
		</Stack>
	);
}
