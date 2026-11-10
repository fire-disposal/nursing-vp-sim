import { Button, Container, SimpleGrid, Stack, Tabs } from "@mantine/core";
import {
	IconAlertTriangle,
	IconAward,
	IconChartPie,
	IconClipboardList,
	IconFileText,
	IconMagnet,
	IconTarget,
	IconTrendingUp,
	IconUser,
	IconUsers,
} from "@tabler/icons-react";
import { isAxiosError } from "axios";
import { useCallback, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import ErrorState from "@/components/ui/error-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import StatCard from "@/components/ui/stat-card";
import { useClassDetailQuery, useClassSummaryQuery } from "@/hooks/useClasses";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import ClassAssignmentsTab from "./ClassAssignmentsTab";
import ClassMembersTab from "./ClassMembersTab";
import ClassRecordsTab from "./ClassRecordsTab";
import {
	buildTabSearch,
	CLASS_TAB_LABEL,
	CLASS_TAB_PARAMS,
	parseClassTab,
	parseMemberRole,
	parseOffset,
	parseRecordStatus,
} from "./class-workspace-tabs";

/**
 * 班级工作台 —— 一个班级的概览、成员、作业与训练记录。
 *
 * 页签写进 URL（`?tab=overview|members|assignments|records`），每个页签的分页/筛选
 * 也留在 URL：刷新、分享、前进后退都回到同一视图；切页签只动 `tab`，回来时页码与
 * 搜索词仍在。这里**不再**持有本地页签状态（旧 `roleTab` 与地址栏互相覆盖的根因）。
 */
export default function ClassDetailPage() {
	const { classId } = useParams<{ classId: string }>();
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();
	const cid = Number(classId);

	const tab = parseClassTab(searchParams.get("tab"));
	const memberRole = parseMemberRole(searchParams.get(CLASS_TAB_PARAMS.members.role));
	const memberOffset = parseOffset(searchParams.get(CLASS_TAB_PARAMS.members.offset));
	const assignmentOffset = parseOffset(searchParams.get(CLASS_TAB_PARAMS.assignments.offset));
	const recordOffset = parseOffset(searchParams.get(CLASS_TAB_PARAMS.records.offset));
	const recordStatus = parseRecordStatus(searchParams.get(CLASS_TAB_PARAMS.records.status));

	/**
	 * 一次改多个 URL 参数（空串 = 删除该键）；`replace` 保持返回历史干净。
	 *
	 * 必须走 react-router 的 `setSearchParams`：直接 `history.replaceState` 只改浏览器地址，
	 * `useSearchParams` 不会收到通知，页面就会与地址栏分叉（正是本页要消灭的那类冲突）。
	 */
	const setParams = useCallback(
		(updates: Array<[string, string]>) => {
			setSearchParams(
				(prev) => {
					const next = new URLSearchParams(prev);
					for (const [key, value] of updates) {
						if (value) next.set(key, value);
						else next.delete(key);
					}
					return next;
				},
				{ replace: true },
			);
		},
		[setSearchParams],
	);

	// 搜索词进 URL，但进请求前防抖：地址栏即时反馈，请求不逐字轰炸
	const urlMemberSearch = searchParams.get(CLASS_TAB_PARAMS.members.search) ?? "";
	const { debouncedValue: memberSearch } = useDebouncedSearch(urlMemberSearch, 300);

	const {
		data: cls,
		isLoading: clsLoading,
		isError,
		error: clsError,
		refetch: refetchClass,
	} = useClassDetailQuery(cid);
	const {
		data: summary,
		isError: summaryFailed,
		error: summaryError,
		refetch: refetchSummary,
	} = useClassSummaryQuery(cid);

	const clsSummary = useMemo(
		() =>
			Array.isArray(summary) ? summary.find((s) => s.class_id === cid) : undefined,
		[summary, cid],
	);

	// 数字参数非法时不要发请求（后端会 422，页面只会显示一个看不懂的错误）
	if (!Number.isInteger(cid) || cid <= 0) {
		return (
			<Container size="lg" p="md">
				<EmptyState
					icon={IconAlertTriangle}
					title="班级参数不合法"
					description="请从班级管理页选择一个班级后再打开工作台"
					action={
						<Button variant="default" onClick={() => navigate("/admin/classes")}>
							返回班级管理
						</Button>
					}
				/>
			</Container>
		);
	}

	if (clsLoading) return <LoadingSkeleton />;
	if (isError) {
		// 404 才是「班级真的没了」；网络/5xx 只是这次没取到，给重试而不是让人以为链接失效
		const missing = isAxiosError(clsError) && clsError.response?.status === 404;
		return (
			<Container size="lg" p="md">
				{missing ? (
					<EmptyState
						icon={IconAlertTriangle}
						title="班级不存在"
						description="该班级可能已被删除，或链接有误"
						action={
							<Button variant="default" onClick={() => navigate("/admin/classes")}>
								返回班级管理
							</Button>
						}
					/>
				) : (
					<ErrorState title="班级信息加载失败" error={clsError} onRetry={() => refetchClass()} />
				)}
			</Container>
		);
	}
	if (!cls) {
		return (
			<Container size="lg" p="md">
				<EmptyState
					icon={IconAlertTriangle}
					title="班级不存在"
					description="该班级可能已被删除，或链接有误"
					action={
						<Button variant="default" onClick={() => navigate("/admin/classes")}>
							返回班级管理
						</Button>
					}
				/>
			</Container>
		);
	}

	const switchTab = (value: string | null) => {
		// 与其它参数写入走同一路径（replaceState），避免一次切换产生两条历史
		const next = buildTabSearch(searchParams, parseClassTab(value));
		const tabValue = next.get("tab");
		setParams([["tab", tabValue ?? ""]]);
	};

	return (
		<Container size="lg" p="md">
			<Stack gap="xl">
				<PageHeader
					title={cls.name}
					subtitle={[cls.school_name, cls.cohort_label ? `届别：${cls.cohort_label}` : "未标注届别"]
						.filter(Boolean)
						.join(" · ")}
					backTo="/admin/classes"
				/>

				{/* 统计只属于概览：成员/作业/记录页签有自己的计数，避免两组数字互相解释不清 */}
				{tab === "overview" && (
					<SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
						<StatCard icon={IconUser} label="学生数" value={cls.student_count} />
						<StatCard icon={IconUsers} label="教师数" value={cls.teacher_count} />
						<StatCard icon={IconMagnet} label="作业数" value={cls.assignment_count} />
						<StatCard icon={IconTarget} label="训练总数" value={summaryFailed ? "—" : (clsSummary?.total_sessions ?? 0)} />
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
				)}

				<Tabs value={tab} onChange={switchTab} keepMounted={false}>
					{/* 窄屏：四个页签允许换行，避免被压扁成不可读的窄条（键盘 Tab 仍逐个可达） */}
					<Tabs.List style={{ flexWrap: "wrap" }}>
						<Tabs.Tab value="overview" leftSection={<IconChartPie size={14} />}>
							{CLASS_TAB_LABEL.overview}
						</Tabs.Tab>
						<Tabs.Tab value="members" leftSection={<IconUsers size={14} />}>
							{CLASS_TAB_LABEL.members}（{cls.student_count + cls.teacher_count}）
						</Tabs.Tab>
						<Tabs.Tab value="assignments" leftSection={<IconClipboardList size={14} />}>
							{CLASS_TAB_LABEL.assignments}（{cls.assignment_count}）
						</Tabs.Tab>
						<Tabs.Tab value="records" leftSection={<IconFileText size={14} />}>
							{CLASS_TAB_LABEL.records}
						</Tabs.Tab>
					</Tabs.List>

					<Tabs.Panel value="overview" pt="lg">
						{summaryFailed ? (
							<ErrorState title="班级统计加载失败" error={summaryError} onRetry={() => refetchSummary()} />
						) : (
						<Card>
							<CardHeader>
								<CardTitle>班级概况</CardTitle>
							</CardHeader>
							<CardContent>
								<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
									<StatCard
										icon={IconTarget}
										label="累计训练时长"
										value={
											clsSummary?.total_minutes != null
												? `${clsSummary.total_minutes} 分钟`
												: "--"
										}
									/>
									<StatCard
										icon={IconUsers}
										label="参与学生数"
										value={clsSummary?.student_count ?? cls.student_count}
									/>
								</SimpleGrid>
							</CardContent>
						</Card>
						)}
					</Tabs.Panel>

					<Tabs.Panel value="members" pt="lg">
						<ClassMembersTab
							classId={cid}
							role={memberRole}
							offset={memberOffset}
							searchInput={urlMemberSearch}
							search={memberSearch}
							onParamsChange={setParams}
						/>
					</Tabs.Panel>

					<Tabs.Panel value="assignments" pt="lg">
						<ClassAssignmentsTab
							classId={cid}
							offset={assignmentOffset}
							onParamsChange={setParams}
						/>
					</Tabs.Panel>

					<Tabs.Panel value="records" pt="lg">
						<ClassRecordsTab
							classId={cid}
							offset={recordOffset}
							status={recordStatus}
							onParamsChange={setParams}
						/>
					</Tabs.Panel>
				</Tabs>
			</Stack>
		</Container>
	);
}
