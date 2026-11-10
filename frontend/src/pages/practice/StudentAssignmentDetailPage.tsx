/**
 * 学生作业详情页 —— 一个作业的完整要求 + 本人全部尝试 + 唯一主 CTA。
 *
 * 数据全部来自 ``GET /api/students/assignments/{id}``（服务端按「仍是该班学生成员 ∩
 * 发布时受众快照」收窄，越界 404）；页面不推导可见性、也不自行推算剩余次数。
 *
 * 开始语义复用训练页既有处理：``start-from-assignment`` 的 409 existing_training
 * 走「继续/放弃」冲突弹窗，其余错误按服务端文案提示。
 */
import { Badge, Box, Button, Group, Modal, Paper, SimpleGrid, Skeleton, Stack, Text, Title } from "@mantine/core";
import {
	IconAlertCircle,
	IconCalendarEvent,
	IconClipboardList,
	IconEye,
	IconPlayerPlay,
	IconStethoscope,
	IconUser,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { abandonRecord } from "@/api";
import { getStudentAssignment, startAssignment } from "@/api/assignments";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import EmptyState from "@/components/ui/empty-state";
import ErrorState from "@/components/ui/error-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import { formatDateTime } from "@/utils/date";
import { getApiErrorMessage } from "@/utils/error";
import { goTraining } from "@/utils/training-nav";
import {
	attemptRuleLabel,
	modeLabel,
	requiredActivitiesLabel,
	requiredArtifactsLabel,
	resolveAssignmentAction,
	timeLimitLabel,
} from "./assignment-action";
import AssignmentAttemptList, { AssignmentAttemptTable } from "./components/AssignmentAttemptList";

type StartErrorDetail = { code?: string; message?: string; record_id?: number; case_name?: string };

const STATUS_META: Record<string, { label: string; color: string }> = {
	not_started: { label: "未开始", color: "gray" },
	in_progress: { label: "进行中", color: "brand" },
	completed: { label: "已完成", color: "green" },
	overdue: { label: "已逾期", color: "red" },
	closed: { label: "已关闭", color: "gray" },
};

function statusMeta(status: string) {
	return STATUS_META[status] ?? { label: status || "未知状态", color: "gray" };
}

/** 作业要求/规则的一行（标签 + 值），移动端纵向堆叠。 */
function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<Box>
			<Text size="xs" c="dimmed" lh={1.4}>
				{label}
			</Text>
			<Text size="sm" lh={1.5} style={{ wordBreak: "break-word" }}>
				{children}
			</Text>
		</Box>
	);
}

export default function StudentAssignmentDetailPage() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const location = useLocation();
	const toast = useToast();
	const queryClient = useQueryClient();
	// 训练壳出口按来源页回跳，回到这一页（含当前路径）
	const trainingFrom = location.pathname + location.search;

	const { data, isPending, isError, error, refetch } = useQuery({
		queryKey: queryKeys.assignments.studentDetail(id),
		queryFn: () => getStudentAssignment(id!).then((r) => r.data),
		enabled: !!id,
		staleTime: 30_000,
	});

	const action = useMemo(() => (data ? resolveAssignmentAction(data) : null), [data]);

	const startMutation = useMutation({
		mutationFn: (assignmentId: string) => startAssignment(assignmentId),
		onSuccess: (res) => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.assignments.all });
			goTraining(navigate, res.data.record_id, trainingFrom);
		},
		onError: (err: unknown) => {
			const axiosErr = err as { status?: number; response?: { data?: { detail?: StartErrorDetail } } };
			const detail = axiosErr.response?.data?.detail;
			if (axiosErr.status === 409 && detail?.code === "existing_training") {
				setConflict({ recordId: detail.record_id ?? null, caseName: detail.case_name ?? "未知病例" });
				return;
			}
			// 服务端有明确文案（已达次数/已过期/已关闭/未开放）就原样展示：
			// 泛化成「请重试」会让学生一直重试一个永远不会成功的动作。
			toast.apiError(err, "开始练习失败，请刷新后重试");
		},
	});

	const [conflict, setConflict] = useState<{ recordId: number | null; caseName: string } | null>(null);

	if (!id) {
		return <ErrorState description="缺少作业编号，请从作业列表进入。" />;
	}

	if (isPending) {
		return (
			<Stack gap="lg">
				<PageHeader title="作业详情" backTo="/assignments" icon={IconClipboardList} />
				<Skeleton height={28} width="60%" radius="sm" />
				<Skeleton height={180} radius="md" />
				<LoadingSkeleton variant="text" message="正在加载作业要求…" />
			</Stack>
		);
	}

	if (isError || !data) {
		const status = (error as { status?: number } | null)?.status;
		// 404 = 不存在 / 已不再发给你（被移出班级或移出名单）。两种原因对学生是同一件事：
		// 这个作业不再属于你，能做的只有回列表。
		if (status === 404) {
			return (
				<Stack gap="lg">
					<PageHeader title="作业详情" backTo="/assignments" icon={IconClipboardList} />
					<EmptyState
						icon={IconClipboardList}
						title="找不到这个作业"
						description="它可能已被删除，或者已不再发布给你。"
						action={
							<Button variant="light" size="xs" onClick={() => navigate("/assignments")}>
								返回作业列表
							</Button>
						}
					/>
				</Stack>
			);
		}
		return (
			<Stack gap="lg">
				<PageHeader title="作业详情" backTo="/assignments" icon={IconClipboardList} />
				<ErrorState error={error} description={getApiErrorMessage(error, "作业详情加载失败")} onRetry={() => refetch()} />
			</Stack>
		);
	}

	const status = statusMeta(data.status);
	const reviewable = data.status === "completed";
	const ctaDisabled = startMutation.isPending;

	const primaryAction = () => {
		switch (action!.kind) {
			case "resume":
				return (
					<Button
						leftSection={<IconPlayerPlay size={16} />}
						onClick={() => goTraining(navigate, action!.recordId!, trainingFrom)}
					>
						继续练习
					</Button>
				);
			case "start":
				return (
					<Button
						leftSection={<IconPlayerPlay size={16} />}
						loading={ctaDisabled}
						onClick={() => startMutation.mutate(data.id)}
					>
						{action!.isRetry ? "再练一次" : "开始练习"}
					</Button>
				);
			case "review":
				return (
					<Button
						leftSection={<IconEye size={16} />}
						onClick={() => navigate(`/record/${action!.recordId}`)}
						disabled={!action!.recordId}
					>
						查看复盘
					</Button>
				);
			default:
				return null;
		}
	};

	return (
		<Stack gap="lg">
			<PageHeader
				title={data.title}
				subtitle={data.hide_case_info ? "隐藏病例练习" : data.case_name || undefined}
				icon={IconClipboardList}
				backTo="/assignments"
				actions={
					<Badge variant="light" color={status.color} size="lg">
						{status.label}
					</Badge>
				}
			/>

			{/* 主行动卡：唯一 CTA。移动端按钮占满整行，桌面端靠右。 */}
			<Paper withBorder radius="md" p="md">
				<Stack gap="sm">
					<Group justify="space-between" gap="sm" wrap="wrap">
						<Stack gap={2}>
							<Text size="sm" fw={600}>
								{modeLabel(data.mode)}
							</Text>
							<Text size="xs" c="dimmed">
								{attemptRuleLabel(data)}
							</Text>
						</Stack>
						<Box style={{ flexShrink: 0 }} w={{ base: "100%", xs: "auto" }}>
							<Group gap="xs" grow={false}>
								{primaryAction()}
							</Group>
						</Box>
					</Group>
					{action!.hint && (
						<Group gap={6} wrap="nowrap" align="flex-start">
							<IconAlertCircle size={14} style={{ marginTop: 2, flexShrink: 0 }} color="var(--mantine-color-dimmed)" />
							<Text size="xs" c="dimmed">
								{action!.hint}
							</Text>
						</Group>
					)}
				</Stack>
			</Paper>

			<Paper withBorder radius="md" p="md">
				<Title order={2} size="sm" fw={600} mb="sm">
					作业要求
				</Title>
				{data.description ? (
					<Text size="sm" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.7 }}>
						{data.description}
					</Text>
				) : (
					<Text size="sm" c="dimmed">
						教师没有填写额外说明。
					</Text>
				)}
			</Paper>

			<Paper withBorder radius="md" p="md">
				<Title order={2} size="sm" fw={600} mb="sm">
					作业信息
				</Title>
				<SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
					<Field label="病例">
						<Group gap={6} wrap="nowrap">
							<IconStethoscope size={14} />
							<Text size="sm" component="span">
								{data.hide_case_info ? "隐藏病例" : data.case_name || "—"}
							</Text>
						</Group>
					</Field>
					<Field label="班级">{data.class_name || "—"}</Field>
					<Field label="发布教师">
						<Group gap={6} wrap="nowrap">
							<IconUser size={14} />
							<Text size="sm" component="span">
								{data.teacher_name || "—"}
							</Text>
						</Group>
					</Field>
					<Field label="开始时间">
						<Group gap={6} wrap="nowrap">
							<IconCalendarEvent size={14} />
							<Text size="sm" component="span">
								{formatDateTime(data.start_time) || "—"}
							</Text>
						</Group>
					</Field>
					<Field label="截止时间">
						<Group gap={6} wrap="nowrap">
							<IconCalendarEvent size={14} />
							<Text size="sm" component="span">
								{formatDateTime(data.end_time) || "—"}
							</Text>
						</Group>
					</Field>
					<Field label="训练方式">{modeLabel(data.mode)}</Field>
					<Field label="尝试规则">{attemptRuleLabel(data)}</Field>
					<Field label="预计时限">{timeLimitLabel(data.time_limit_minutes)}</Field>
					<Field label="需要完成">{requiredActivitiesLabel(data.required_activities ?? [])}</Field>
					<Field label="必交内容">{requiredArtifactsLabel(data.required_artifacts ?? [])}</Field>
					<Field label="已用次数">{data.attempt_count} 次</Field>
					<Field label="剩余次数">
						{data.remaining_attempts === null || data.remaining_attempts === undefined
							? "不限"
							: `${data.remaining_attempts} 次`}
					</Field>
				</SimpleGrid>
			</Paper>

			<Paper withBorder radius="md" p="md">
				<Group justify="space-between" mb="sm" gap="sm">
					<Title order={2} size="sm" fw={600}>
						我的尝试
					</Title>
					<Text size="xs" c="dimmed">
						共 {data.attempts.length} 条记录
					</Text>
				</Group>
				{/* 窄屏用卡片列表（避免横向滚动），宽屏用表格 */}
				<Box visibleFrom="sm">
					<AssignmentAttemptTable attempts={data.attempts} reviewable={reviewable} />
				</Box>
				<Box hiddenFrom="sm">
					<AssignmentAttemptList attempts={data.attempts} reviewable={reviewable} />
				</Box>
			</Paper>

			{conflict && (
				<Modal opened onClose={() => setConflict(null)} title="有进行中的训练" size={360} centered withinPortal>
					<Text size="sm" c="dimmed" mb="md">
						你有一个未完成的训练「{conflict.caseName}」。
					</Text>
					<Stack gap="xs">
						<Button
							color="green"
							onClick={() => {
								setConflict(null);
								if (conflict.recordId) goTraining(navigate, conflict.recordId, trainingFrom);
								else navigate("/history");
							}}
						>
							继续之前的训练
						</Button>
						<Button
							variant="default"
							color="red"
							onClick={async () => {
								try {
									if (conflict.recordId) await abandonRecord(String(conflict.recordId));
								} catch {
									toast.apiError(null, "放弃记录失败");
									return;
								}
								queryClient.invalidateQueries({ queryKey: queryKeys.training.all });
								setConflict(null);
								startMutation.mutate(data.id);
							}}
						>
							放弃并开始本次练习
						</Button>
						<Button variant="default" onClick={() => setConflict(null)}>
							取消
						</Button>
					</Stack>
				</Modal>
			)}
		</Stack>
	);
}
