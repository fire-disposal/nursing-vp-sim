import { useQuery } from "@tanstack/react-query";
import {
	Alert,
	Badge,
	Button,
	Checkbox,
	Group,
	Loader,
	Modal,
	ScrollArea,
	Select,
	Stack,
	Text,
} from "@mantine/core";
import { IconUserPlus } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { getUsers } from "@/api/admin/users";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import { SearchInput } from "@/components/ui/search-input";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import { useAddClassMembers } from "@/hooks/useClasses";

const ROLE_DATA = [
	{ value: "student", label: "学生" },
	{ value: "teacher", label: "教师" },
];

interface AddMembersDialogProps {
	open: boolean;
	onClose: () => void;
	classId: number;
	/** 本班已有成员 id（当前页）：列表里标记为「已在班级」并禁止重复选择。 */
	existingIds: Set<number>;
}

/**
 * 班级详情里的「添加成员」：搜索用户 → 勾选 → 选择身份 → 批量加入。
 * 已在本班的用户不可勾选（重复添加无意义），角色调整走用户编辑或批量添加接口的 updated 语义。
 */
export default function AddMembersDialog({
	open,
	onClose,
	classId,
	existingIds,
}: AddMembersDialogProps) {
	const [selected, setSelected] = useState<Set<number>>(new Set());
	const [memberRole, setMemberRole] = useState<"student" | "teacher">("student");
	const { searchInput, debouncedValue, handleSearchChange, setSearchInput } =
		useDebouncedSearch();
	const { confirm } = useConfirm();
	const toast = useToast();
	const addMut = useAddClassMembers(classId);

	useEffect(() => {
		if (!open) {
			setSelected(new Set());
			setMemberRole("student");
			setSearchInput("");
		}
	}, [open]);

	const { data, isLoading } = useQuery({
		queryKey: queryKeys.admin.users.list({ search: debouncedValue, limit: 50 }),
		queryFn: () =>
			getUsers({ search: debouncedValue || undefined, limit: 50 }).then((r) => r.data),
		enabled: open,
		staleTime: 60_000,
	});

	const candidates = data?.items ?? [];

	const toggle = (id: number, checked: boolean) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (checked) next.add(id);
			else next.delete(id);
			return next;
		});
	};

	const handleSubmit = async () => {
		if (selected.size === 0) return;
		const roleLabel = memberRole === "teacher" ? "教师" : "学生";
		const ok = await confirm({
			title: "添加成员",
			message: `将 ${selected.size} 名用户以「${roleLabel}」身份加入本班？`,
		});
		if (!ok) return;
		try {
			const result = await addMut.mutateAsync({
				userIds: [...selected],
				memberRole,
			});
			const parts = [`新增 ${result.added} 人`];
			if (result.updated > 0) parts.push(`更新角色 ${result.updated} 人`);
			if (result.skipped > 0) parts.push(`跳过 ${result.skipped} 人`);
			toast.success(parts.join("，"));
			if ((result.errors ?? []).length > 0) {
				toast.warning(`部分失败：${(result.errors ?? []).slice(0, 3).join("；")}`);
			}
			onClose();
		} catch (e: unknown) {
			toast.apiError(e, "添加成员失败");
		}
	};

	return (
		<Modal
			opened={open}
			onClose={onClose}
			title={<><IconUserPlus size={18} /> 添加成员</>}
			size={560}
			centered
			withinPortal
		>
			<Stack gap="md">
				<Group gap={8} align="flex-end" wrap="nowrap">
					<Select
						label="加入身份"
						value={memberRole}
						onChange={(v) =>
							setMemberRole((v as "student" | "teacher") ?? "student")
						}
						data={ROLE_DATA}
						allowDeselect={false}
						w={120}
					/>
					<SearchInput
						value={searchInput}
						onChange={handleSearchChange}
						placeholder="搜索用户名、姓名或学号..."
					/>
				</Group>
				<Text size="xs" c="dimmed">
					重复添加是幂等的：已在班级中的成员不会重复计入，角色冲突时以后端返回的「更新角色」结果为准。
				</Text>
				<Alert color="blue" variant="light" p="xs">
					<Text size="xs">
						已选 {selected.size} 人，将以「{memberRole === "teacher" ? "教师" : "学生"}」身份加入本班。
					</Text>
				</Alert>
				<ScrollArea h={260}>
					{isLoading ? (
						<Group justify="center" py="xl">
							<Loader size="sm" />
						</Group>
					) : candidates.length === 0 ? (
						<Text size="sm" c="dimmed" ta="center" py="xl">
							没有匹配的用户
						</Text>
					) : (
						<Stack gap={4}>
							{candidates.map((u) => {
								const inClass = existingIds.has(u.id);
								return (
									<Group key={u.id} gap={8} wrap="nowrap">
										<Checkbox
											checked={inClass || selected.has(u.id)}
											disabled={inClass}
											onChange={(e) => toggle(u.id, e.currentTarget.checked)}
											aria-label={`选择 ${u.display_name}`}
										/>
										<div style={{ minWidth: 0, flex: 1 }}>
											<Text size="sm" truncate>
												{u.display_name}
												<Text component="span" size="xs" c="dimmed" ml={6}>
													{u.username}
													{u.student_id ? ` · ${u.student_id}` : ""}
												</Text>
											</Text>
										</div>
										{inClass ? (
											<Badge size="xs" variant="light" color="gray">已在班级</Badge>
										) : (
											<Badge size="xs" variant="outline">{u.role_display_name || u.role}</Badge>
										)}
									</Group>
								);
							})}
						</Stack>
					)}
				</ScrollArea>
				<Group justify="flex-end" gap={8}>
					<Button variant="outline" onClick={onClose}>
						取消
					</Button>
					<Button
						disabled={selected.size === 0 || addMut.isPending}
						onClick={handleSubmit}
					>
						{addMut.isPending ? "添加中…" : `添加 ${selected.size} 人`}
					</Button>
				</Group>
			</Stack>
		</Modal>
	);
}
