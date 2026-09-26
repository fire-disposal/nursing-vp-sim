import { APP_TIME_ZONE } from "@/utils/date";
import {
	Badge,
	Box,
	Button,
	Center,
	Checkbox,
	Container,
	Group,
	Loader,
	Paper,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	ThemeIcon,
} from "@mantine/core";
import {
	IconAlertTriangle,
	IconAward,
	IconMagnet,
	IconSchool,
	IconTarget,
	IconTrendingUp,
	IconUser,
	IconUserPlus,
	IconUsers,
} from "@tabler/icons-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import Pagination from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import StatCard from "@/components/ui/stat-card";
import AddMembersDialog from "@/components/admin/classes/AddMembersDialog";
import MemberAffiliations from "@/components/admin/classes/MemberAffiliations";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import {
	useClassDetailQuery,
	useClassMembersQuery,
	useClassSummaryQuery,
	useRemoveClassMember,
	useRemoveClassMembers,
} from "@/hooks/useClasses";
import type { ClassMemberItem, MemberRole } from "@/types/store";

const LIMIT = 20;

const ROLE_LABEL: Record<MemberRole, string> = {
	student: "学生",
	teacher: "教师",
};

function formatJoined(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("zh-CN", { timeZone: APP_TIME_ZONE });
}

export default function ClassDetailPage() {
	const { classId } = useParams<{ classId: string }>();
	const navigate = useNavigate();
	const cid = Number(classId);
	const toast = useToast();
	const { confirm } = useConfirm();
	const [roleTab, setRoleTab] = useState<MemberRole>("student");
	const [offset, setOffset] = useState(0);
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
	const [showAddDialog, setShowAddDialog] = useState(false);
	const { searchInput, debouncedValue, handleSearchChange } = useDebouncedSearch();

	const { data: cls, isLoading: clsLoading, isError } = useClassDetailQuery(cid);
	const { data: summary } = useClassSummaryQuery(cid);
	const membersQuery = useClassMembersQuery(cid, {
		role: roleTab,
		search: debouncedValue || undefined,
		offset,
		limit: LIMIT,
	});
	const removeOne = useRemoveClassMember(cid);
	const removeBulk = useRemoveClassMembers(cid);

	if (clsLoading) return <LoadingSkeleton />;
	if (isError || !cls) {
		return (
			<EmptyState
				icon={IconAlertTriangle}
				title="班级不存在"
				description="该班级可能已被删除，或链接有误"
				action={
					<Button variant="outline" onClick={() => navigate("/admin/classes")}>
						返回班级管理
					</Button>
				}
			/>
		);
	}

	const members: ClassMemberItem[] = membersQuery.data?.items ?? [];
	const total = membersQuery.data?.total ?? 0;
	const existingIds = new Set(members.map((m) => m.user_id));
	const clsSummary = Array.isArray(summary)
		? summary.find((s) => s.class_id === cid)
		: undefined;

	const switchTab = (value: string | null) => {
		setRoleTab(value === "teacher" ? "teacher" : "student");
		setSelectedIds(new Set());
		setOffset(0);
	};

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
		<Container size="lg" p="md">
			<Stack gap="xl">
				<PageHeader
					title={cls.name}
					subtitle={cls.cohort_label ? `届别：${cls.cohort_label}` : "未标注届别"}
					backTo="/admin/classes"
				/>

				<SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
					<StatCard icon={IconUser} label="学生数" value={cls.student_count} />
					<StatCard icon={IconUsers} label="教师数" value={cls.teacher_count} />
					<StatCard icon={IconMagnet} label="作业数" value={cls.assignment_count} />
					<StatCard
						icon={IconTarget}
						label="训练总数"
						value={clsSummary?.total_sessions ?? 0}
					/>
					<StatCard
						icon={IconAward}
						label="平均得分"
						value={clsSummary?.avg_score != null ? `${clsSummary.avg_score}分` : "--"}
					/>
					<StatCard
						icon={IconTrendingUp}
						label="完成率"
						value={clsSummary?.completion_rate != null ? `${clsSummary.completion_rate}%` : "--"}
					/>
				</SimpleGrid>

				<Card>
					<CardHeader>
						<CardTitle>
							<Group gap={8} wrap="nowrap" justify="space-between" w="100%">
								<Group gap={8} wrap="nowrap">
									<IconSchool size={16} />
									<Text component="span" fw={600} inherit>花名册</Text>
								</Group>
								<Button
									size="xs"
									leftSection={<IconUserPlus size={14} />}
									onClick={() => setShowAddDialog(true)}
								>
									添加成员
								</Button>
							</Group>
						</CardTitle>
					</CardHeader>
					<CardContent>
						<Tabs value={roleTab} onChange={switchTab} mb="md">
							<Tabs.List>
								<Tabs.Tab value="student">
									学生（{cls.student_count}）
								</Tabs.Tab>
								<Tabs.Tab value="teacher">
									教师（{cls.teacher_count}）
								</Tabs.Tab>
							</Tabs.List>
						</Tabs>

						<Group gap={8} mb="md" wrap="wrap">
							<Box maw={320} style={{ flex: 1 }}>
								<SearchInput
									value={searchInput}
									onChange={(value) => {
										handleSearchChange(value);
										setOffset(0);
									}}
									placeholder="搜索姓名、用户名或学号..."
								/>
							</Box>
							<Text size="sm" c="dimmed">
								{ROLE_LABEL[roleTab]}共 {total} 人
							</Text>
							{selectedIds.size > 0 && (
								<>
									<Text size="sm" fw={500}>已选 {selectedIds.size} 人</Text>
									<Button
										size="xs"
										color="red"
										variant="light"
										onClick={handleRemoveSelected}
										disabled={removeBulk.isPending}
									>
										{removeBulk.isPending ? "移出中…" : "移出班级"}
									</Button>
								</>
							)}
						</Group>

						{membersQuery.isLoading && members.length === 0 ? (
							<Center py={48}>
								<Loader size={24} color="gray" />
							</Center>
						) : members.length === 0 ? (
							<EmptyState
								icon={IconSchool}
								title={debouncedValue ? "没有匹配的成员" : `暂无${ROLE_LABEL[roleTab]}`}
								description={
									debouncedValue
										? "换个关键词试试"
										: "点击右上角「添加成员」把用户加入本班"
								}
							/>
						) : (
							<>
								<Group gap={8} mb={4}>
									<Checkbox
										checked={members.length > 0 && members.every((m) => selectedIds.has(m.user_id))}
										onChange={(e) => toggleAll(e.currentTarget.checked)}
										aria-label="全选本页成员"
									/>
									<Text size="xs" c="dimmed">全选本页</Text>
								</Group>
								<Stack gap={8}>
									{members.map((m) => (
										<Paper key={m.user_id} p="sm">
											<Group gap={12} wrap="nowrap" align="flex-start">
												<Checkbox
													mt={4}
													checked={selectedIds.has(m.user_id)}
													onChange={(e) => {
														setSelectedIds((prev) => {
															const next = new Set(prev);
															if (e.currentTarget.checked) next.add(m.user_id);
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
														<Text size="sm" fw={500}>{m.display_name}</Text>
														<Text size="xs" c="dimmed">{m.username}</Text>
														{m.student_id && (
															<Text size="xs" c="dimmed">学号 {m.student_id}</Text>
														)}
														<Badge size="xs" variant={m.member_role === "teacher" ? "light" : "outline"} color={m.member_role === "teacher" ? "grape" : "blue"}>
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
															currentClassId={cid}
														/>
													</Box>
												</div>
												<Button
													size="xs"
													variant="subtle"
													color="red"
													onClick={() => handleRemoveOne(m)}
													disabled={removeOne.isPending}
												>
													移出
												</Button>
											</Group>
										</Paper>
									))}
								</Stack>
								<Pagination
									total={total}
									offset={offset}
									limit={LIMIT}
									onChange={setOffset}
								/>
							</>
						)}
					</CardContent>
				</Card>

			</Stack>

			<AddMembersDialog
				open={showAddDialog}
				onClose={() => setShowAddDialog(false)}
				classId={cid}
				existingIds={existingIds}
			/>
		</Container>
	);
}
