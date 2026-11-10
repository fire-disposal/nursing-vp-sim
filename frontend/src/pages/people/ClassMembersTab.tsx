import {
	Badge,
	Box,
	Button,
	Center,
	Checkbox,
	Group,
	Loader,
	Paper,
	Stack,
	Tabs,
	Text,
	ThemeIcon,
} from "@mantine/core";
import { IconSchool, IconSearchOff, IconUser, IconUserPlus } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import AddMembersDialog from "@/components/admin/classes/AddMembersDialog";
import MemberAffiliations from "@/components/admin/classes/MemberAffiliations";
import { useToast } from "@/components/Toast";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import EmptyState from "@/components/ui/empty-state";
import ErrorState from "@/components/ui/error-state";
import Pagination from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import {
	useClassDetailQuery,
	useClassMembersQuery,
	useRemoveClassMember,
	useRemoveClassMembers,
} from "@/hooks/useClasses";
import type { ClassMemberItem, MemberRole } from "@/types/store";
import { APP_TIME_ZONE } from "@/utils/date";
import { CLASS_TAB_PARAMS, type MemberRoleFilter, parseOffset } from "./class-workspace-tabs";

const LIMIT = 20;

const ROLE_LABEL: Record<MemberRole, string> = {
	student: "学生",
	teacher: "教师",
};

function formatJoined(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime())
		? "-"
		: date.toLocaleDateString("zh-CN", { timeZone: APP_TIME_ZONE });
}

interface MembersTabProps {
	classId: number;
	role: MemberRoleFilter;
	offset: number;
	/** 地址栏里的搜索词（输入框的值，逐字同步） */
	searchInput: string;
	/** 防抖后真正发给服务端的搜索词 */
	search: string;
	/** 一次改多个 URL 参数（空串 = 删除该键），单次写入避免中间态丢键 */
	onParamsChange: (updates: Array<[string, string]>) => void;
}

/**
 * 成员页签 —— 班级花名册的完整增删/搜索/分页。
 *
 * 状态全部由 URL 驱动（角色页签、搜索词、页码），所以「切到作业页签再回来」
 * 仍停在原来那一页与那次搜索上；这也是旧实现里 `roleTab` 本地态与地址栏
 * 互相覆盖的根因所在，此处不再保留任何本地页签态。
 */
export default function ClassMembersTab({
	classId,
	role,
	offset,
	searchInput,
	search,
	onParamsChange,
}: MembersTabProps) {
	const toast = useToast();
	const { confirm } = useConfirm();
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
	const [showAddDialog, setShowAddDialog] = useState(false);
	const keys = CLASS_TAB_PARAMS.members;

	// 班级详情用于成员数徽标与「已在班内」过滤，与页面头部共用同一缓存条目
	const { data: cls } = useClassDetailQuery(classId);
	const membersQuery = useClassMembersQuery(classId, {
		role,
		search: search || undefined,
		offset,
		limit: LIMIT,
	});
	const removeOne = useRemoveClassMember(classId);
	const removeBulk = useRemoveClassMembers(classId);

	const members: ClassMemberItem[] = membersQuery.data?.items ?? [];
	const total = membersQuery.data?.total ?? 0;
	const existingIds = new Set(members.map((m) => m.user_id));

	const switchRole = (value: string | null) => {
		setSelectedIds(new Set());
		// 换角色等同换视图：页码与搜索词一起清掉，否则会落在空页
		onParamsChange([
			[keys.role, value === "teacher" ? "teacher" : ""],
			[keys.offset, ""],
			[keys.search, ""],
		]);
	};

	// 搜索词进 URL（返回/分享即恢复），但发请求用防抖后的值
	const handleSearchChange = (value: string) => {
		onParamsChange([
			[keys.search, value],
			[keys.offset, ""],
		]);
	};

	// 换页/换搜索后旧的选择不再对应屏幕上的行，清掉避免批量操作误伤
	useEffect(() => {
		setSelectedIds(new Set());
	}, [role, search, offset]);

	const toggleAll = (checked: boolean) => {
		setSelectedIds(checked ? new Set(members.map((m) => m.user_id)) : new Set());
	};

	const handleRemoveOne = async (member: ClassMemberItem) => {
		const ok = await confirm({
			title: "移出班级",
			message: `确定将「${member.display_name}」移出本班吗？其在其他班级的归属不受影响。`,
			confirmLabel: "确定移出",
			danger: true,
		});
		if (!ok) return;
		try {
			await removeOne.mutateAsync(member.user_id);
			setSelectedIds((prev) => {
				const next = new Set(prev);
				next.delete(member.user_id);
				return next;
			});
			toast.success("已移出班级");
		} catch (e: unknown) {
			toast.apiError(e, "移出失败");
		}
	};

	const handleRemoveSelected = async () => {
		const count = selectedIds.size;
		if (count === 0) return;
		const ok = await confirm({
			title: "批量移出班级",
			message: `确定将选中的 ${count} 名成员移出本班吗？他们在其他班级的归属不受影响。`,
			confirmLabel: "确定移出",
			danger: true,
		});
		if (!ok) return;
		try {
			const result = await removeBulk.mutateAsync([...selectedIds]);
			toast.success(
				`已移出 ${result.removed} 人${result.skipped > 0 ? `，${result.skipped} 人不在本班` : ""}`,
			);
			setSelectedIds(new Set());
		} catch (e: unknown) {
			toast.apiError(e, "批量移出失败");
		}
	};

	return (
		<Card>
			<CardHeader>
				<Group gap={8} wrap="nowrap" justify="space-between" w="100%">
					<Group gap={8} wrap="nowrap">
						<IconSchool size={16} />
						<Text component="span" size="md" fw={600} lh={1.35}>花名册</Text>
					</Group>
					<Button
						size="xs"
						leftSection={<IconUserPlus size={14} />}
						onClick={() => setShowAddDialog(true)}
					>
						添加成员
					</Button>
				</Group>
			</CardHeader>
			<CardContent>
				<Tabs value={role} onChange={switchRole} mb="md">
					<Tabs.List>
						<Tabs.Tab value="student">学生（{cls?.student_count ?? 0}）</Tabs.Tab>
						<Tabs.Tab value="teacher">教师（{cls?.teacher_count ?? 0}）</Tabs.Tab>
					</Tabs.List>
				</Tabs>

				<Group gap={8} mb="md" wrap="wrap" align="center">
					<Box maw={320} style={{ flex: "1 1 220px", minWidth: 180 }}>
						<SearchInput
							value={searchInput}
							onChange={handleSearchChange}
							placeholder="搜索姓名、用户名或学号..."
						/>
					</Box>
					<Text size="sm" c="dimmed" className="tabular-nums">
						{ROLE_LABEL[role]}共 {membersQuery.isError ? "—" : total} 人
					</Text>
					{selectedIds.size > 0 && (
						<>
							<Text size="sm" fw={500}>
								已选 {selectedIds.size} 人
							</Text>
							<Button
								size="xs"
								color="red"
								variant="default"
								onClick={handleRemoveSelected}
								disabled={removeBulk.isPending}
							>
								{removeBulk.isPending ? "移出中…" : "移出班级"}
							</Button>
						</>
					)}
				</Group>

				{membersQuery.isError ? (
					/* 先判失败再判空：取数失败时「没有匹配的成员」会让人以为班里真没人（或搜索词写错） */
					<ErrorState
						title="花名册加载失败"
						error={membersQuery.error}
						onRetry={() => membersQuery.refetch()}
					/>
				) : membersQuery.isLoading && members.length === 0 ? (
					<Center py={48}>
						<Loader size={24} color="gray" />
					</Center>
				) : members.length === 0 ? (
					<EmptyState
						icon={search ? IconSearchOff : IconSchool}
						title={search ? "没有匹配的成员" : `暂无${ROLE_LABEL[role]}`}
						description={
							search ? "换个关键词试试" : "点击右上角「添加成员」把用户加入本班"
						}
						action={
							search ? (
								<Button
									size="xs"
									variant="default"
									onClick={() => onParamsChange([[keys.search, ""], [keys.offset, ""]])}
								>
									清除搜索
								</Button>
							) : undefined
						}
					/>
				) : (
					<>
						<Group gap={8} mb={4}>
							<Checkbox
								checked={members.every((m) => selectedIds.has(m.user_id))}
								indeterminate={
									selectedIds.size > 0 && !members.every((m) => selectedIds.has(m.user_id))
								}
								onChange={(e) => toggleAll(e.currentTarget.checked)}
								aria-label="全选本页成员"
							/>
							<Text size="xs" c="dimmed">
								全选本页
							</Text>
						</Group>
						<Stack gap={8}>
							{members.map((m) => (
								<Paper key={m.user_id} p="sm">
									<Group gap={12} wrap="nowrap" align="flex-start">
										<Checkbox
											mt={4}
											checked={selectedIds.has(m.user_id)}
											onChange={(e) => {
												const checked = e.currentTarget.checked;
												setSelectedIds((prev) => {
													const next = new Set(prev);
													if (checked) next.add(m.user_id);
													else next.delete(m.user_id);
													return next;
												});
											}}
											aria-label={`选择 ${m.display_name}`}
										/>
										<ThemeIcon size={36} radius="md" variant="light" color="brand">
											<IconUser size={16} />
										</ThemeIcon>
										<div style={{ minWidth: 0, flex: 1 }}>
											<Group gap={8} wrap="wrap">
												<Text size="sm" fw={500} style={{ wordBreak: "break-word" }}>
													{m.display_name}
												</Text>
												<Text size="xs" c="dimmed">
													{m.username}
												</Text>
												{m.student_id && (
													<Text size="xs" c="dimmed">
														学号 {m.student_id}
													</Text>
												)}
												<Badge
													size="xs"
													variant={m.member_role === "teacher" ? "light" : "outline"}
													color={m.member_role === "teacher" ? "grape" : "blue"}
												>
													{ROLE_LABEL[m.member_role === "teacher" ? "teacher" : "student"]}
												</Badge>
												<Text size="xs" c="dimmed">
													加入于 {formatJoined(m.joined_at)}
												</Text>
											</Group>
											<Box mt={4}>
												<MemberAffiliations
													userId={m.user_id}
													username={m.username}
													currentClassId={classId}
												/>
											</Box>
										</div>
										<Button
											size="xs"
											variant="subtle"
											color="red"
											onClick={() => handleRemoveOne(m)}
											disabled={removeOne.isPending}
											aria-label={`将 ${m.display_name} 移出本班`}
										>
											移出
										</Button>
									</Group>
								</Paper>
							))}
						</Stack>
						<Pagination
							total={total}
							offset={parseOffset(String(offset))}
							limit={LIMIT}
							onChange={(next) => onParamsChange([[keys.offset, next > 0 ? String(next) : ""]])}
						/>
					</>
				)}
			</CardContent>

			<AddMembersDialog
				open={showAddDialog}
				onClose={() => setShowAddDialog(false)}
				classId={classId}
				existingIds={existingIds}
			/>
		</Card>
	);
}
