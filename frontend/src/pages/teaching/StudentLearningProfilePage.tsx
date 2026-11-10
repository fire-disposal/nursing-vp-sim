import {
	Anchor,
	Badge,
	Button,
	Group,
	Paper,
	SegmentedControl,
	Select,
	SimpleGrid,
	Stack,
	Table,
	Text,
	Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import {
	IconArrowRight,
	IconChartHistogram,
	IconClipboardList,
	IconFileAnalytics,
	IconHistory,
	IconUserCircle,
} from "@tabler/icons-react";
import { useCallback, useMemo } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
	getStudentLearningProfile,
	type StudentLearningProfileParams,
	type StudentProfileAssignmentItem,
	type StudentProfileTrainingItem,
} from "@/api/scoreboard";
import { queryKeys } from "@/api/query-keys";
import EmptyState from "@/components/ui/empty-state";
import ErrorState from "@/components/ui/error-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import Pagination from "@/components/ui/pagination";
import StatCard from "@/components/ui/stat-card";
import TableScroll from "@/components/ui/table-scroll";
import StudentTrendView from "@/components/admin/scoreboard/StudentTrendView";
import { formatDateTime } from "@/utils/date";
import { formatDuration } from "@/utils/duration";

const TAB_OVERVIEW = "overview";
const TAB_ASSIGNMENTS = "assignments";
const TAB_TRAINING = "training";

const TABS = [TAB_OVERVIEW, TAB_ASSIGNMENTS, TAB_TRAINING] as const;
type ProfileTab = (typeof TABS)[number];

const TRAINING_LIMIT = 20;

const TAB_OPTIONS = [
	{ value: TAB_OVERVIEW, label: "概览" },
	{ value: TAB_ASSIGNMENTS, label: "作业" },
	{ value: TAB_TRAINING, label: "训练记录" },
];

/** 作业进度状态的中文与配色 —— 与后端 `modules.assignments.progress` 的取值一一对应。 */
const ASSIGNMENT_STATUS: Record<string, { label: string; color: string }> = {
	not_started: { label: "未开始", color: "gray" },
	in_progress: { label: "进行中", color: "blue" },
	completed: { label: "已完成", color: "green" },
	overdue: { label: "已逾期", color: "orange" },
	closed: { label: "已关闭", color: "gray" },
};

const RECORD_STATUS: Record<string, { label: string; color: string }> = {
	in_progress: { label: "进行中", color: "blue" },
	completed: { label: "已完成", color: "green" },
	abandoned: { label: "已放弃", color: "gray" },
	discarded: { label: "已丢弃", color: "gray" },
};

/** 训练记录页签的状态筛选选项（值域 = `training_records.status` 的检查约束）。 */
const TRAINING_STATUS_OPTIONS = [
	{ value: "", label: "全部状态" },
	{ value: "in_progress", label: "进行中" },
	{ value: "completed", label: "已完成" },
	{ value: "abandoned", label: "已放弃" },
	{ value: "discarded", label: "已丢弃" },
];

function parseTab(raw: string | null): ProfileTab {
	return TABS.find((value) => value === raw) ?? TAB_OVERVIEW;
}

/** 记录详情的唯一入口：所有行（作业代表记录 / 训练记录）都进教师记录页。 */
const recordHref = (recordId: number) => `/admin/records/${recordId}`;

function RecordLink({ recordId, label }: { recordId: number; label: string }) {
	return (
		<Anchor component={Link} to={recordHref(recordId)} size="sm" aria-label={label}>
			查看记录
		</Anchor>
	);
}

/**
 * 学生学习档案 —— 教师围绕**一个学生**连续看趋势、作业与训练记录。
 *
 * 数据来自 `GET /scoreboard/students/{id}/profile`（一道 `assignment_manage` 权限即可，
 * 不要求 `user_manage`）：服务端已按院校作用域校验该生是否可见，跨院校一律 404。
 * 趋势渲染复用 `StudentTrendView`（与排行弹窗同一份只读视图），可比性与进步幅度
 * 完全由服务端判定，页面不复制任何判断。
 *
 * 页签写进 URL（`?tab=`），刷新/分享保持同一视图；训练记录的状态筛选与分页同样进 URL。
 */
export default function StudentLearningProfilePage() {
	const { userId: rawUserId } = useParams<{ userId: string }>();
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();

	const userId = Number(rawUserId);
	const hasValidUserId = Number.isInteger(userId) && userId > 0;

	const tab = parseTab(searchParams.get("tab"));
	const trainingStatus = searchParams.get("training_status") || "";
	const trainingOffset = Math.max(0, parseInt(searchParams.get("training_offset") || "0", 10) || 0);

	const setParam = useCallback(
		(key: string, value: string) => {
			setSearchParams(
				(prev) => {
					const next = new URLSearchParams(prev);
					if (value) next.set(key, value);
					else next.delete(key);
					// 分页只对训练记录页签有意义：状态变化必须回到第一页
					if (key === "training_status") next.delete("training_offset");
					return next;
				},
				{ replace: true },
			);
		},
		[setSearchParams],
	);

	const params = useMemo<StudentLearningProfileParams>(
		() => ({
			include_free: true,
			training_status: trainingStatus || null,
			training_offset: trainingOffset,
			training_limit: TRAINING_LIMIT,
		}),
		[trainingStatus, trainingOffset],
	);

	const { data, isLoading, isError, error, refetch } = useQuery({
		queryKey: queryKeys.scoreboard.profile(userId, params),
		queryFn: () => getStudentLearningProfile(userId, params).then((r) => r.data),
		enabled: hasValidUserId,
		staleTime: 60_000,
	});

	if (!hasValidUserId) {
		return (
			<Stack gap="lg">
				<PageHeader
					title="学生学习档案"
					subtitle="趋势、作业与训练记录"
					icon={IconUserCircle}
					backTo="/admin/scoreboard"
				/>
				<EmptyState
					icon={IconUserCircle}
					title="学生参数不合法"
					description="请从成绩管理页选择一名学生后再打开档案"
					action={
						<Button variant="light" onClick={() => navigate("/admin/scoreboard")}>
							返回成绩管理
						</Button>
					}
				/>
			</Stack>
		);
	}

	if (isLoading) {
		return (
			<Stack gap="lg">
				<PageHeader title="学生学习档案" icon={IconUserCircle} backTo="/admin/scoreboard" />
				<LoadingSkeleton variant="spinner" message="加载档案中…" />
			</Stack>
		);
	}

	if (isError || !data) {
		return (
			<Stack gap="lg">
				<PageHeader title="学生学习档案" icon={IconUserCircle} backTo="/admin/scoreboard" />
				<ErrorState
					title="学生档案加载失败"
					error={error}
					onRetry={() => refetch()}
				/>
			</Stack>
		);
	}

	const { student, trend, assignments, training, training_total, training_summary } = data;

	return (
		<Stack gap="lg">
			<PageHeader
				title={student.display_name}
				subtitle={[student.student_id, ...student.classes.map((c) => c.name)].filter(Boolean).join(" · ")}
				icon={IconUserCircle}
				backTo="/admin/scoreboard"
				actions={
					<Button
						variant="light"
						size="sm"
						leftSection={<IconChartHistogram size={15} />}
						onClick={() => navigate("/admin/scoreboard")}
					>
						成绩管理
					</Button>
				}
			/>

			{/* 身份块：长姓名在窄屏折行而不是撑破布局 */}
			<Paper withBorder p="md">
				<Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
					<Stack gap={2} style={{ minWidth: 0, flex: "1 1 220px" }}>
						<Text fw={600} size="sm" style={{ wordBreak: "break-word" }}>
							{student.display_name}
						</Text>
						<Text size="xs" c="dimmed">
							{student.student_id ? `学号 ${student.student_id}` : "无学号"} · @{student.username}
						</Text>
					</Stack>
					<Group gap={6} wrap="wrap">
						{student.classes.length === 0 ? (
							<Text size="xs" c="dimmed">无班级</Text>
						) : (
							student.classes.map((c) => (
								<Badge key={c.id} variant="light" color="blue" size="sm">
									{c.name}
									{c.cohort_label ? ` · ${c.cohort_label}` : ""}
								</Badge>
							))
						)}
					</Group>
				</Group>
			</Paper>

			<SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
				<StatCard value={training_total} label="训练记录" color="blue" icon={IconHistory} />
				<StatCard value={training_summary.completed} label="已完成" color="green" icon={IconClipboardList} />
				<StatCard
					value={training_summary.avg_score != null ? training_summary.avg_score.toFixed(1) : "-"}
					label="平均分（数值参考）"
					color="blue"
					icon={IconChartHistogram}
				/>
				<StatCard
					value={formatDuration(training_summary.avg_duration_seconds)}
					label="平均用时"
					color="amber"
					icon={IconFileAnalytics}
				/>
			</SimpleGrid>

			<SegmentedControl
				fullWidth
				value={tab}
				onChange={(value) => setParam("tab", value === TAB_OVERVIEW ? "" : value)}
				data={TAB_OPTIONS}
				aria-label="档案视图切换"
			/>

			{tab === TAB_OVERVIEW && (
				<Paper withBorder p="md">
					<StudentTrendView trend={trend} />
				</Paper>
			)}

			{tab === TAB_ASSIGNMENTS && (
				<AssignmentsTab items={assignments} />
			)}

			{tab === TAB_TRAINING && (
				<TrainingTab
					items={training}
					total={training_total}
					offset={trainingOffset}
					status={trainingStatus}
					onStatusChange={(value) => setParam("training_status", value)}
					onOffsetChange={(value) => setParam("training_offset", value > 0 ? String(value) : "")}
				/>
			)}

			{/* 概览页签给一条明确的下一步：教师看完趋势后最常做的是去作业页签核对进度 */}
			{tab === TAB_OVERVIEW && assignments.length > 0 && (
				<Group justify="flex-end">
					<Button
						variant="subtle"
						size="sm"
						rightSection={<IconArrowRight size={14} />}
						onClick={() => setParam("tab", TAB_ASSIGNMENTS)}
					>
						查看作业进度（{assignments.length}）
					</Button>
				</Group>
			)}
		</Stack>
	);
}

function AssignmentsTab({ items }: { items: StudentProfileAssignmentItem[] }) {
	if (items.length === 0) {
		return (
			<EmptyState
				icon={IconClipboardList}
				title="暂无作业"
				description="该学生还没有收到任何练习发布"
			/>
		);
	}
	return (
		<TableScroll minWidth={720}>
			<Table highlightOnHover verticalSpacing="sm">
				<Table.Thead>
					<Table.Tr>
						<Table.Th style={{ minWidth: 180 }}>作业</Table.Th>
						<Table.Th style={{ width: 140 }}>病例</Table.Th>
						<Table.Th style={{ width: 96 }}>进度</Table.Th>
						<Table.Th style={{ width: 96 }}>尝试</Table.Th>
						<Table.Th style={{ width: 88 }}>得分</Table.Th>
						<Table.Th style={{ width: 150 }}>截止时间</Table.Th>
						<Table.Th style={{ width: 120 }}>操作</Table.Th>
					</Table.Tr>
				</Table.Thead>
				<Table.Tbody>
					{items.map((item) => {
						const status = ASSIGNMENT_STATUS[item.status] ?? { label: item.status, color: "gray" };
						const attemptCap = item.max_attempts && item.max_attempts > 0 ? `/ ${item.max_attempts}` : "";
						return (
							<Table.Tr key={item.assignment_id}>
								<Table.Td>
									<Stack gap={0}>
										<Text size="sm" fw={500} lineClamp={2}>
											{item.title}
										</Text>
										<Text size="xs" c="dimmed">
											{item.class_name}
										</Text>
									</Stack>
								</Table.Td>
								<Table.Td>
									<Text size="sm" lineClamp={2}>
										{item.case_name}
									</Text>
								</Table.Td>
								<Table.Td>
									<Badge variant="light" color={status.color} size="sm">
										{status.label}
									</Badge>
								</Table.Td>
								<Table.Td>
									<Text size="sm" style={{ fontVariantNumeric: "tabular-nums" }}>
										{item.attempt_count}
										{attemptCap}
									</Text>
								</Table.Td>
								<Table.Td>
									{item.score_total != null ? (
										<Text size="sm" fw={600}>
											{item.score_total}
										</Text>
									) : (
										<Text size="sm" c="dimmed">
											—
										</Text>
									)}
								</Table.Td>
								<Table.Td>
									<Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
										{formatDateTime(item.end_time)}
									</Text>
								</Table.Td>
								<Table.Td>
									<Group gap="sm" wrap="nowrap">
										{item.record_id != null && (
											<RecordLink
												recordId={item.record_id}
												label={`查看 ${item.title} 的教师记录详情`}
											/>
										)}
										<Anchor
											component={Link}
											to={`/admin/assignments/${item.assignment_id}`}
											size="sm"
										>
											作业详情
										</Anchor>
									</Group>
								</Table.Td>
							</Table.Tr>
						);
					})}
				</Table.Tbody>
			</Table>
		</TableScroll>
	);
}

function TrainingTab({
	items,
	total,
	offset,
	status,
	onStatusChange,
	onOffsetChange,
}: {
	items: StudentProfileTrainingItem[];
	total: number;
	offset: number;
	status: string;
	onStatusChange: (value: string) => void;
	onOffsetChange: (value: number) => void;
}) {
	return (
		<Stack gap="sm">
			<Group justify="space-between" wrap="wrap" gap="sm">
				<Title order={3} size="h6">
					训练记录
				</Title>
				<Select
					size="sm"
					w={{ base: "100%", sm: 160 }}
					value={status || null}
					placeholder="全部状态"
					data={TRAINING_STATUS_OPTIONS}
					onChange={(value) => onStatusChange(value ?? "")}
					aria-label="按状态筛选训练记录"
				/>
			</Group>

			{items.length === 0 ? (
				<EmptyState
					icon={IconHistory}
					title="暂无训练记录"
					description={status ? "当前状态下没有训练记录，试试「全部状态」" : "该学生还没有训练记录"}
				/>
			) : (
				<TableScroll minWidth={760}>
					<Table highlightOnHover verticalSpacing="sm">
						<Table.Thead>
							<Table.Tr>
								<Table.Th style={{ minWidth: 180 }}>病例</Table.Th>
								<Table.Th style={{ width: 140 }}>来源</Table.Th>
								<Table.Th style={{ width: 96 }}>状态</Table.Th>
								<Table.Th style={{ width: 88 }}>得分</Table.Th>
								<Table.Th style={{ width: 88 }}>时长</Table.Th>
								<Table.Th style={{ width: 150 }}>开始时间</Table.Th>
								<Table.Th style={{ width: 96 }}>操作</Table.Th>
							</Table.Tr>
						</Table.Thead>
						<Table.Tbody>
							{items.map((item) => {
								const recordStatus = RECORD_STATUS[item.status] ?? {
									label: item.status,
									color: "gray",
								};
								return (
									<Table.Tr key={item.record_id}>
										<Table.Td>
											<Text size="sm" fw={500} lineClamp={2}>
												{item.case_name}
											</Text>
										</Table.Td>
										<Table.Td>
											{item.assignment_title ? (
												<Badge variant="light" color="blue" size="xs" title={item.assignment_title}>
													作业
												</Badge>
											) : (
												<Text size="xs" c="dimmed">
													自主训练
												</Text>
											)}
										</Table.Td>
										<Table.Td>
											<Badge variant="light" color={recordStatus.color} size="sm">
												{recordStatus.label}
											</Badge>
										</Table.Td>
										<Table.Td>
											{item.score_total != null ? (
												<Text size="sm" fw={600}>
													{item.score_total}
												</Text>
											) : item.score_degraded ? (
												<Text size="xs" c="red">
													评分降级
												</Text>
											) : item.scoring_status === "pending" ||
												item.scoring_status === "processing" ? (
												<Badge variant="light" color="yellow" size="xs">
													评分中
												</Badge>
											) : item.scoring_status === "failed" ? (
												<Text size="xs" c="red">
													评分失败
												</Text>
											) : (
												<Text size="sm" c="dimmed">
													—
												</Text>
											)}
										</Table.Td>
										<Table.Td>
											<Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
												{item.end_time ? formatDuration(item.duration_seconds) : "进行中"}
											</Text>
										</Table.Td>
										<Table.Td>
											<Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
												{formatDateTime(item.start_time)}
											</Text>
										</Table.Td>
										<Table.Td>
											<RecordLink
												recordId={item.record_id}
												label={`查看 ${item.case_name} 的教师记录详情`}
											/>
										</Table.Td>
									</Table.Tr>
								);
							})}
						</Table.Tbody>
					</Table>
				</TableScroll>
			)}

			{total > TRAINING_LIMIT && (
				<Pagination total={total} offset={offset} limit={TRAINING_LIMIT} onChange={onOffsetChange} />
			)}

			{/* 概览里的进步幅度与训练记录同源：这里把它显式说清楚，避免两处数字观感不一致 */}
			{items.length > 0 && items.some((i) => i.score_reviewed) && (
				<Text size="xs" c="dimmed">
					得分列为展示成绩（教师复核分优先）
				</Text>
			)}
		</Stack>
	);
}
