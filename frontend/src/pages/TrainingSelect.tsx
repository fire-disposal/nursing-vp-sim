import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	IconAlertTriangle,
	IconAward,
	IconBook2,
	IconChartBar,
	IconClipboardCheck,
	IconClipboardList,
	IconClock,
	IconGift,
	IconHome,
	IconPlayerPlay,
	IconRotate,
	IconSpeakerphone,
	IconStar,
	IconStethoscope,
	IconTarget,
	IconTrendingUp,
	IconX,
} from "@tabler/icons-react";
import { Badge, Box, Button, Group, Modal, Paper, SegmentedControl, SimpleGrid, Stack, Text, ThemeIcon, Title, UnstyledButton } from "@mantine/core";
import { motion } from "motion/react";
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { abandonRecord, getCases, getNotifications, getRecords, markNotificationRead, startBlindBox, startTraining } from "@/api";
import type { components } from "@/api/api-types.gen";
import { getStudentAssignments, startAssignment } from "@/api/assignments";
import { queryKeys } from "@/api/query-keys";
import { getStudentRanking, getTrends } from "@/api/stats";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import EmptyState from "@/components/ui/empty-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import Pagination from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import StatCard from "@/components/ui/stat-card";
import { ALL_CAPABILITIES } from "@/engine/capabilities.gen";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";
import useAuthStore from "@/stores/authStore";

type CaseBrief = components["schemas"]["CaseBrief"];
type TrainingRecordBrief = components["schemas"]["TrainingRecordBrief"];
type TrainingNotificationItem = components["schemas"]["TrainingNotificationItem"];

const DIFFICULTY_LABELS: Record<number, string> = { 1: "初级", 2: "中级", 3: "高级" };
const LIMIT = 50;

const CAP_COLORS: Record<string, string> = {
	physical_exam: "violet",
	nursing_record: "blue",
	quiz: "blue",
};

function getPatientSummary(ps: CaseBrief["patient_summary"]): { gender?: string; age?: number; chief_complaint?: string } {
	if (ps && typeof ps === "object") return ps as { gender?: string; age?: number; chief_complaint?: string };
	return {};
}

function Stars({ level }: { level?: number | null }) {
	const lvl = level && DIFFICULTY_LABELS[level] ? level : 1;
	return (
		<Group gap={2} wrap="nowrap">
			{[1, 2, 3].map((i) => (
				<IconStar
					key={i}
					size={12}
					fill={i <= lvl ? "var(--mantine-color-yellow-6)" : "none"}
					color={i <= lvl ? "var(--mantine-color-yellow-6)" : "var(--mantine-color-gray-3)"}
				/>
			))}
		</Group>
	);
}

function CapBadges({ caps }: { caps: Record<string, boolean> | undefined }) {
	if (!caps) return null;
	const enabled = Object.entries(ALL_CAPABILITIES)
		.filter(([, d]) => d.tier === "toggleable")
		.filter(([k]) => caps[k]);
	if (enabled.length === 0) return null;
	return (
		<Group gap={4} wrap="wrap">
			{enabled.map(([key, def]) => (
				<Badge key={key} variant="light" color={CAP_COLORS[key] ?? "gray"} size="xs">
					{def.label}
				</Badge>
			))}
		</Group>
	);
}

export default function TrainingSelect() {
	const [tab, setTab] = useState<"home" | "self" | "assignments">("home");
	const [difficultyFilter, setDifficultyFilter] = useState(0);
	const { searchInput, debouncedValue: search, handleSearchChange } = useDebouncedSearch("", 300);
	const [offset, setOffset] = useState(0);
	const navigate = useNavigate();
	const toast = useToast();
	const queryClient = useQueryClient();
	const { confirm } = useConfirm();
	const user = useAuthStore((s) => s.user);
	const [dismissedNotificationIds, setDismissedNotificationIds] = useState<Set<number>>(() => new Set());
	const [conflict, setConflict] = useState<{ recordId: number; caseName: string } | null>(null);

	const { data: casesData, isLoading: casesLoading, isError: casesError } = useQuery({
		queryKey: queryKeys.cases.list({ difficulty: difficultyFilter, offset, search }),
		queryFn: () => getCases({ offset, limit: LIMIT, ...(difficultyFilter > 0 ? { difficulty: difficultyFilter } : {}), ...(search ? { name: search } : {}) }).then((r) => r.data),
		staleTime: 5 * 60_000, placeholderData: keepPreviousData, enabled: tab === "self",
	});

	const { data: assignmentsData } = useQuery({
		queryKey: queryKeys.assignments.student,
		queryFn: () => getStudentAssignments().then((r) => r.data),
		staleTime: 30_000,
	});

	// 拆分三个轻量查询：进行中（主行动卡/续练态）、已完成计数（limit=1 取 total）、最近 5 条。
	// 相比原来一次拉 50 条做客户端过滤，payload 更小且计数不再被 50 封顶截断。
	const { data: inProgressData } = useQuery({
		queryKey: queryKeys.training.records({ status: "in_progress", limit: 50 }),
		queryFn: () => getRecords({ status: "in_progress", limit: 50, exclude_is_test: false, user_id: user?.user_id }).then((r) => r.data),
		staleTime: 30_000,
	});
	const { data: completedData } = useQuery({
		queryKey: queryKeys.training.records({ status: "completed", limit: 1 }),
		queryFn: () => getRecords({ status: "completed", limit: 1, exclude_is_test: false, user_id: user?.user_id }).then((r) => r.data),
		staleTime: 30_000,
	});
	const { data: recentData } = useQuery({
		queryKey: queryKeys.training.records({ limit: 5 }),
		queryFn: () => getRecords({ limit: 5, exclude_is_test: false, user_id: user?.user_id }).then((r) => r.data),
		staleTime: 30_000,
	});

	const inProgressRecords = inProgressData?.items ?? [];
	const records = recentData?.items ?? [];
	const assignments = (assignmentsData ?? []) as Array<{
		id: string; title: string; case_name: string; status: string;
		end_time: string; record_id?: number | null; score_total?: number | null;
		is_overdue?: boolean; max_attempts?: number | null; attempt_count?: number;
	}>;

	const inProgressCount = inProgressRecords.length;
	const completedCount = completedData?.total ?? 0;
	const pendingAssignments = useMemo(
		() => assignments.filter((a) => a.status === "in_progress" && (!a.end_time || new Date(a.end_time) >= new Date())),
		[assignments],
	);

	// ── Notifications (home tab) ──
	const { data: notifData } = useQuery({
		queryKey: queryKeys.notifications.recent(),
		queryFn: () => getNotifications({ limit: 3 }).then((r) => r.data),
		staleTime: 30_000,
	});
	const recentNotifs = useMemo(
		() => (notifData?.items ?? [])
			.filter((n) => !n.is_read && !dismissedNotificationIds.has(n.id))
			.slice(0, 2),
		[notifData?.items, dismissedNotificationIds],
	);
	const dismissNotificationMutation = useMutation({
		mutationFn: (id: number) => markNotificationRead(id),
		onMutate: (id) => {
			setDismissedNotificationIds((prev) => {
				const next = new Set(prev);
				next.add(id);
				return next;
			});
		},
		onError: (_error, id) => {
			setDismissedNotificationIds((prev) => {
				const next = new Set(prev);
				next.delete(id);
				return next;
			});
			toast.error("关闭通知失败，请重试");
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
		},
	});

	// ── Training stats (home tab) ──
	const { data: ranking } = useQuery({
		queryKey: queryKeys.stats.ranking({}),
		queryFn: () => getStudentRanking().then((r) => r.data),
		staleTime: 60_000,
	});
	const myStats = ranking?.items?.[0];
	const { data: trends } = useQuery({
		queryKey: queryKeys.stats.trends("month"),
		queryFn: () => getTrends().then((r) => r.data),
		staleTime: 60_000,
	});
	const trendItems = trends?.daily ?? [];

	const inProgressByCase = useMemo(() => {
		const map = new Map<number, TrainingRecordBrief>();
		for (const r of inProgressRecords) {
			if (!map.has(r.case_id)) map.set(r.case_id, r);
		}
		return map;
	}, [inProgressRecords]);

	type StartResponse = components["schemas"]["TrainingStartResponse"];
	const startMutation = useMutation({
		mutationFn: ({ caseId, timeLimit }: { caseId: number; timeLimit: number }) => startTraining(caseId, {}, timeLimit),
		onSuccess: (res) => {
			const data: StartResponse = res.data;
			if (data.session) queryClient.setQueryData(queryKeys.training.detail(String(data.record_id)), data.session);
			navigate(`/training/${data.record_id}`);
		},
		onError: (err: unknown) => {
			const axiosErr = err as { status?: number; response?: { data?: { detail?: { code?: string; record_id?: number; case_name?: string } } } };
			if (axiosErr.status === 409 && axiosErr.response?.data?.detail?.code === "existing_training") {
				const d = axiosErr.response.data.detail;
				setConflict({ recordId: d.record_id!, caseName: d.case_name ?? "未知病例" });
				return;
			}
			toast.error("开始训练失败，请重试");
		},
	});
	const blindBoxMutation = useMutation({
		mutationFn: () => startBlindBox(),
		onSuccess: (res) => {
			const data: StartResponse = res.data;
			if (data.session) queryClient.setQueryData(queryKeys.training.detail(String(data.record_id)), data.session);
			navigate(`/training/${data.record_id}`);
		},
		onError: (err: unknown) => {
			const axiosErr = err as { status?: number; response?: { data?: { detail?: { code?: string; record_id?: number; case_name?: string } } } };
			if (axiosErr.status === 409 && axiosErr.response?.data?.detail?.code === "existing_training") {
				const d = axiosErr.response.data.detail;
				setConflict({ recordId: d.record_id!, caseName: d.case_name ?? "未知病例" });
				return;
			}
			toast.error("盲盒训练开始失败，请重试");
		},
	});
	const handleRestart = async (c: CaseBrief, rec: TrainingRecordBrief) => {
		const ok = await confirm({
			title: "重新开始训练", message: `放弃「${c.name}」当前未完成的训练并重新开始？`, confirmLabel: "放弃并重开", danger: true,
		});
		if (!ok) return;
		try { await abandonRecord(rec.id); } catch { toast.apiError(null, "放弃记录失败"); return; }
		queryClient.invalidateQueries({ queryKey: queryKeys.training.all });
		startMutation.mutate({ caseId: c.id, timeLimit: c.time_limit_minutes ?? 20 });
	};
	const handleStartAssignment = async (assignmentId: string) => {
		try {
			const res = await startAssignment(assignmentId);
			const data = res.data as Record<string, unknown>;
			if (typeof (data as { record_id?: number }).record_id === "number") {
				if (data.session) queryClient.setQueryData(queryKeys.training.detail(String(data.record_id)), data.session);
				navigate(`/training/${(data as { record_id: number }).record_id}`);
			}
		} catch (err: unknown) {
			const axiosErr = err as { status?: number; response?: { data?: { detail?: { code?: string; record_id?: number; case_name?: string } } } };
			if (axiosErr.status === 409 && axiosErr.response?.data?.detail?.code === "existing_training") {
				const d = axiosErr.response.data.detail;
				setConflict({ recordId: d.record_id!, caseName: d.case_name ?? "未知病例" });
				return;
			}
			toast.apiError(err, "开始作业失败，请刷新后重试");
		}
	};

	const cases = casesData?.items ?? [];
	const total = casesData?.total ?? 0;

	const hour = new Date().getHours();
	const greeting = hour < 12 ? "上午好" : hour < 18 ? "下午好" : "晚上好";
	const recentRecords = records;
	const primaryInProgress = inProgressRecords[0];
	const nextAssignment = pendingAssignments[0];

	if (conflict) return (
		<Modal opened onClose={() => setConflict(null)} title="有进行中的训练" size={360} centered withinPortal>
				<Text size="sm" c="dimmed" mb="md">你有一个未完成的训练「{conflict.caseName}」。</Text>
				<Stack gap="xs">
					<Button color="green" onClick={() => { setConflict(null); navigate(`/training/${conflict.recordId}`); }}>
						继续之前的训练
					</Button>
					<Button variant="light" color="red" onClick={async () => {
						await abandonRecord(String(conflict.recordId));
						queryClient.invalidateQueries({ queryKey: queryKeys.training.all });
						setConflict(null);
					}}>
						放弃并开始新训练
					</Button>
					<Button variant="outline" onClick={() => setConflict(null)}>取消</Button>
				</Stack>
		</Modal>
	);

	return (
		<Stack gap="lg">
			<SegmentedControl
				value={tab}
				onChange={(v) => setTab(v as "home" | "self" | "assignments")}
				style={{ width: "fit-content" }}
				data={[
					{ value: "home", label: <Group gap={6} wrap="nowrap"><IconHome size={14} />首页</Group> },
					{ value: "self", label: <Group gap={6} wrap="nowrap"><IconBook2 size={14} />自主训练</Group> },
					{ value: "assignments", label: <Group gap={6} wrap="nowrap"><IconClipboardList size={14} />我的作业</Group> },
				]}
			/>

			{tab === "home" && (
				<Stack gap="lg">
					{recentNotifs.length > 0 && (
						<Paper withBorder radius="md" style={{ overflow: "hidden" }}>
							<Group
								justify="space-between"
								gap="sm"
								px="md"
								py="sm"
								style={{ borderBottom: "1px solid var(--mantine-color-default-border)", background: "var(--mantine-color-brand-0)" }}
							>
								<Group gap="xs">
									<ThemeIcon size={32} radius="md" variant="light" color="brand">
										<IconSpeakerphone size={16} />
									</ThemeIcon>
									<Box>
										<Text size="sm" fw={600}>新的训练通知</Text>
										<Text size="xs" c="dimmed">可关闭，关闭后会标记为已读</Text>
									</Box>
								</Group>
								<Button variant="subtle" color="gray" size="sm" onClick={() => navigate("/notifications")}>
									查看全部
								</Button>
							</Group>
							<Stack gap={0}>
								{recentNotifs.map((n: TrainingNotificationItem) => (
									<Group
										key={n.id}
										gap="sm"
										align="flex-start"
										px="md"
										py="sm"
										wrap="nowrap"
										style={{ borderBottom: "1px solid var(--mantine-color-gray-2)" }}
									>
										<UnstyledButton
											onClick={() => navigate(n.record_id ? `/training/${n.record_id}` : "/notifications")}
											style={{ flex: 1, minWidth: 0, textAlign: "left" }}
										>
											<Text size="sm" fw={500} truncate>{n.title}</Text>
											{n.body && (
												<Text size="xs" c="dimmed" mt={4} lineClamp={2} lh={1.5}>{n.body}</Text>
											)}
										</UnstyledButton>
										<Button
											variant="subtle" color="gray"
											size="sm" w={36} h={36} p={0}
											style={{ flexShrink: 0 }}
											onClick={() => dismissNotificationMutation.mutate(n.id)}
											disabled={dismissNotificationMutation.isPending}
											aria-label={`关闭通知：${n.title}`}
										>
											<IconX size={15} />
										</Button>
									</Group>
								))}
							</Stack>
						</Paper>
					)}

					{/* 训练主卡：问候 + 主行动 */}
					<Paper
						withBorder
						radius="md"
						p={{ base: "lg", sm: "xl" }}
						style={{
							position: "relative",
							overflow: "hidden",
							minHeight: 220,
							display: "flex",
							flexDirection: "column",
							justifyContent: "space-between",
							gap: 32,
							background:
								"linear-gradient(135deg, var(--mantine-color-brand-0) 0%, var(--mantine-color-body) 55%)",
						}}
					>
						{/* 装饰性听诊器水印 */}
						<Box
							style={{
								position: "absolute",
								right: -28,
								top: -28,
								width: 180,
								height: 180,
								borderRadius: "50%",
								background: "var(--mantine-color-brand-1)",
								opacity: 0.55,
								pointerEvents: "none",
							}}
						/>
						<ThemeIcon
							size={72}
							radius="xl"
							variant="light"
							color="brand"
							style={{ position: "absolute", right: 28, bottom: 28, pointerEvents: "none" }}
						>
							<IconStethoscope size={34} strokeWidth={1.5} />
						</ThemeIcon>

						<Box style={{ position: "relative", maxWidth: 640 }}>
							<Text size="sm" fw={600} c="brand">
								{greeting}，{user?.display_name || "同学"}
							</Text>
							<Title order={2} size="xl" mt="sm" lh={1.35}>
								{primaryInProgress ? "继续完成这次护理问诊" : nextAssignment ? "先处理最近一项训练作业" : "开始一次新的护理模拟训练"}
							</Title>
							<Text size="sm" c="dimmed" mt="sm" lh={1.7} style={{ maxWidth: 560 }}>
								{primaryInProgress
									? `当前未完成病例：${primaryInProgress.case_name}。先回到对话，再生成评分。`
									: nextAssignment
										? `待完成作业：${nextAssignment.title} · ${nextAssignment.case_name}`
										: "选择一个病例进入沉浸式问诊，完成后查看评分和改进建议。"}
							</Text>
						</Box>

						<Group gap="sm" wrap="wrap" style={{ position: "relative" }}>
							{primaryInProgress ? (
								<Button size="lg" onClick={() => navigate(`/training/${primaryInProgress.id}`)}>
									<IconPlayerPlay size={16} />继续训练
								</Button>
							) : nextAssignment ? (
								<Button size="lg" onClick={() => handleStartAssignment(nextAssignment.id)}>
									<IconPlayerPlay size={16} />开始作业
								</Button>
							) : (
								<Button size="lg" onClick={() => setTab("self")}>
									<IconBook2 size={16} />选择病例
								</Button>
							)}
							{(primaryInProgress || nextAssignment) && (
								<Button variant="outline" size="lg" onClick={() => setTab("self")}>
									{primaryInProgress ? "选择其他病例" : "自主训练"}
								</Button>
							)}
						</Group>
					</Paper>

					<SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
						<Paper withBorder radius="md" p="md">
							<Group justify="space-between" gap="sm">
								<Text size="sm" fw={600}>待完成作业</Text>
								<Button variant="subtle" color="gray" size="xs" onClick={() => setTab("assignments")}>
									查看全部
								</Button>
							</Group>
							{pendingAssignments.length > 0 ? (
								<Stack gap="xs" mt="sm">
									{pendingAssignments.slice(0, 3).map((a: { id: string; title: string; case_name: string; end_time?: string }) => (
										<Paper key={a.id} withBorder radius="md" p="sm">
											<Group justify="space-between" align="flex-start" gap="sm" wrap="nowrap">
												<Box style={{ minWidth: 0 }}>
													<Text size="sm" fw={500} truncate>{a.title}</Text>
													<Text size="xs" c="dimmed" mt={4}>
														{a.case_name}{a.end_time ? ` · ${new Date(a.end_time).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} 截止` : ""}
													</Text>
												</Box>
												<Button size="sm" onClick={() => handleStartAssignment(a.id)}>
													<IconPlayerPlay size={14} />开始
												</Button>
											</Group>
										</Paper>
									))}
								</Stack>
							) : (
								<Paper radius="md" mt="md" p="md" withBorder style={{ borderStyle: "dashed" }}>
									<Text size="sm" c="dimmed">
										暂无待完成作业，可以自主选择病例训练。
									</Text>
								</Paper>
							)}
						</Paper>

						<Paper withBorder radius="md" p="md">
							<Group gap="xs" mb="sm">
								<IconTrendingUp size={16} style={{ color: "var(--mantine-color-gray-6)" }} />
								<Text size="sm" fw={500}>最近训练</Text>
							</Group>
							{primaryInProgress && (
								<Paper radius="md" mb="sm" px="sm" py="xs" bg="yellow.0" style={{ border: "1px solid var(--mantine-color-yellow-3)" }}>
									<Group justify="space-between" gap="sm" wrap="nowrap">
										<Box style={{ minWidth: 0 }}>
											<Group gap={6} wrap="nowrap">
												<IconPlayerPlay size={12} style={{ color: "var(--mantine-color-yellow-8)" }} />
												<Text size="xs" fw={600} c="yellow.8">进行中的训练</Text>
											</Group>
											<Text size="xs" c="dimmed" mt={2} truncate>{primaryInProgress.case_name}</Text>
										</Box>
										<Group gap={6} wrap="nowrap">
											<Button size="sm" variant="outline" onClick={() => navigate(`/training/${primaryInProgress.id}`)}>继续</Button>
											<Button size="sm" variant="subtle" color="red" onClick={async () => {
												const ok = await confirm({ title: "放弃训练", message: `放弃「${primaryInProgress.case_name}」的未完成训练？`, confirmLabel: "放弃", danger: true });
												if (!ok) return;
												try { await abandonRecord(primaryInProgress.id); queryClient.invalidateQueries({ queryKey: queryKeys.training.all }); } catch { toast.apiError(null, "放弃失败"); }
											}}>放弃</Button>
										</Group>
									</Group>
								</Paper>
							)}
							{recentRecords.length > 0 ? (
								<Stack gap={4}>
									{recentRecords.map((r) => (
										<UnstyledButton
											key={r.id}
											onClick={() => navigate(r.status === "in_progress" ? `/training/${r.id}` : `/record/${r.id}`)}
											style={{ width: "100%", padding: "8px 12px", borderRadius: "var(--mantine-radius-md)", transition: "background 120ms ease" }}
											className="hover-row"
										>
											<Group justify="space-between" gap="sm" wrap="nowrap">
												<Box style={{ minWidth: 0, flex: 1 }}>
													<Text size="sm" fw={500} truncate>{r.case_name}</Text>
													<Text size="xs" c="dimmed" mt={2}>
														{new Date(r.start_time).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · 问诊
													</Text>
												</Box>
												<Box style={{ flexShrink: 0, marginLeft: 12 }}>
													{r.status === "completed" && r.score_total != null ? (
														<Text size="sm" fw={600} c="brand" className="tabular-nums">{r.score_total} 分</Text>
													) : r.status === "in_progress" ? (
														<Badge variant="light" color="brand">进行中</Badge>
													) : null}
												</Box>
											</Group>
										</UnstyledButton>
									))}
								</Stack>
							) : (
								<Paper radius="md" px="sm" py="lg" ta="center" withBorder style={{ borderStyle: "dashed" }}>
									<Text size="sm" c="dimmed">
										还没有训练记录。先从一个病例开始。
									</Text>
								</Paper>
							)}
						</Paper>
					</SimpleGrid>

					<SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
						{/* 训练概览 — 状态磁贴 + 统计 */}
						<Paper withBorder radius="md" p="md">
							<Group gap="xs" mb="sm">
								<IconTarget size={16} style={{ color: "var(--mantine-color-gray-6)" }} />
								<Text size="sm" fw={500}>训练概览</Text>
							</Group>
							<SimpleGrid cols={3} spacing="xs">
								<TrainingTile
									icon={<IconPlayerPlay size={18} style={{ color: "var(--mantine-color-yellow-7)" }} />}
									value={inProgressCount}
									label="进行中"
									color="yellow"
									onClick={() => { if (inProgressCount > 0) navigate("/history?status=in_progress"); }}
								/>
								<TrainingTile
									icon={<IconClipboardCheck size={18} style={{ color: "var(--mantine-color-green-7)" }} />}
									value={completedCount}
									label="已完成"
									color="green"
									onClick={() => { if (completedCount > 0) navigate("/history?status=completed"); }}
								/>
								<TrainingTile
									icon={<IconBook2 size={18} style={{ color: "var(--mantine-color-red-7)" }} />}
									value={pendingAssignments.length}
									label="待做作业"
									color="red"
									onClick={() => { if (pendingAssignments.length > 0) setTab("assignments"); }}
								/>
							</SimpleGrid>
							{myStats && (
								<SimpleGrid cols={{ base: 1, sm: 2, xl: 1 }} spacing="sm" mt="md" pt="md" style={{ borderTop: "1px solid var(--mantine-color-gray-3)" }}>
									<StatCard icon={IconTarget} label="完成训练" value={myStats.total_sessions ?? 0} color="blue" />
									<StatCard icon={IconAward} label="平均得分" value={myStats.avg_score != null ? `${myStats.avg_score}分` : "--"} color="green" />
									<StatCard icon={IconTrendingUp} label="排名" value={myStats.rank ? `第${myStats.rank}名` : "--"} color="blue" />
									<StatCard icon={IconClock} label="总时长" value={myStats.total_minutes ? `${myStats.total_minutes}分钟` : "--"} color="amber" />
								</SimpleGrid>
							)}
							<Box mt="md" pt="md" style={{ borderTop: "1px solid var(--mantine-color-gray-3)" }}>
								<Group gap="xs" mb="sm">
									<IconChartBar size={16} style={{ color: "var(--mantine-color-gray-6)" }} />
									<Text size="sm" fw={500}>进步趋势</Text>
								</Group>
								{trendItems.length > 0 ? (
									<SimpleGrid cols={4} spacing="xs">
										{trendItems.slice(0, 8).map((item, index) => (
											<Paper key={`${String(item.period_label ?? "period")}-${index}`} radius="md" bg="gray.1" p={8} ta="center">
												<Text size="sm" fw={600} className="tabular-nums">
													{item.average_score != null ? String(item.average_score) : "--"}
												</Text>
												<Text size="11px" c="dimmed" mt={2} truncate>
													{item.period_label != null ? String(item.period_label) : `第${index + 1}周`}
												</Text>
											</Paper>
										))}
									</SimpleGrid>
								) : (
									<Paper radius="md" px="sm" py="md" ta="center" withBorder style={{ borderStyle: "dashed" }}>
										<Text size="xs" c="dimmed">
											完成更多训练后显示趋势
										</Text>
									</Paper>
								)}
							</Box>
						</Paper>
					</SimpleGrid>
				</Stack>
			)}

			{/* ═══ Tab: 自主训练 ═══ */}
			{tab === "self" && (
				<Stack gap="md">
					<Group gap="xs" wrap="wrap">
						{[0, 1, 2, 3].map((d) => (
							<Button key={d} type="button" variant={difficultyFilter === d ? "filled" : "subtle"} color={difficultyFilter === d ? undefined : "gray"} size="xs" onClick={() => { setDifficultyFilter(d); setOffset(0); }}
							>{d === 0 ? "全部难度" : DIFFICULTY_LABELS[d]}</Button>
						))}
						<Box style={{ flex: 1 }} />
						<Box w={176}>
							<SearchInput value={searchInput} onChange={(value) => { handleSearchChange(value); setOffset(0); }} placeholder="搜索病例…" />
						</Box>
					</Group>
					<Paper radius="md" withBorder px="md" py="sm" bg="brand.0" style={{ borderStyle: "dashed", borderColor: "var(--mantine-color-brand-3)" }}>
						<Group justify="space-between" gap="sm" wrap="wrap">
							<Box style={{ minWidth: 0 }}>
								<Group gap={6} wrap="nowrap">
									<IconGift size={15} style={{ color: "var(--mantine-color-brand-7)", flexShrink: 0 }} />
									<Text size="sm" fw={600}>盲盒训练</Text>
								</Group>
								<Text size="xs" c="dimmed" mt={2} truncate>
									随机抽取一个开放病例，隐藏标题与引导，考验临场问诊
								</Text>
							</Box>
							<Button
								size="sm"
								style={{ flexShrink: 0 }}
								onClick={() => blindBoxMutation.mutate()}
								disabled={blindBoxMutation.isPending}
							>
								{blindBoxMutation.isPending ? "抽取中…" : "开始盲盒"}
							</Button>
						</Group>
					</Paper>
					{casesLoading ? (
						<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
							{Array.from({ length: 6 }).map((_, i) => <LoadingSkeleton key={i} variant="card" />)}
						</SimpleGrid>
					) : casesError ? (
						<EmptyState icon={IconAlertTriangle} title="加载失败" description="请检查网络后重试" action={<Button variant="outline" size="sm" onClick={() => window.location.reload()}>重试</Button>} />
					) : cases.length === 0 ? (
						<EmptyState icon={IconAlertTriangle} title="暂无可用病例" description={search ? "没有匹配的病例" : "管理员尚未开放自主练习病例"} />
					) : (
						<>
							<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
								{cases.map((c, idx) => {
									const summary = getPatientSummary(c.patient_summary);
									const inProgress = inProgressByCase.get(c.id);
									return (
										<motion.div key={c.id}
											initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
											transition={{ duration: 0.25, delay: idx * 0.04, ease: "easeOut" }}>
											<Paper withBorder radius="md" p="md" style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", transition: "box-shadow 150ms ease, transform 150ms ease" }} className="case-card">
												<Group justify="space-between" align="flex-start" gap="xs" wrap="nowrap">
													<Box style={{ minWidth: 0, flex: 1 }}>
														<Text size="sm" fw={600} truncate>{c.name}</Text>
														<Text size="xs" c="dimmed" mt={2} style={{ lineHeight: 1.6 }}>
															{[summary.gender, summary.age != null ? `${summary.age}岁` : null].filter(Boolean).join(" · ")}
															{summary.chief_complaint && <> · {summary.chief_complaint.slice(0, 30)}</>}
														</Text>
													</Box>
													<Stars level={c.difficulty} />
												</Group>
												<CapBadges caps={c.capabilities} />
												{inProgress ? (
													<Group gap="xs" style={{ marginTop: "auto" }}>
														<Button style={{ flex: 1 }} size="sm" onClick={() => navigate(`/training/${inProgress.id}`)}><IconPlayerPlay size={14} />继续训练</Button>
														<Button variant="outline" size="sm" onClick={() => handleRestart(c, inProgress)} disabled={startMutation.isPending}><IconRotate size={14} /></Button>
													</Group>
												) : (
													<Button style={{ marginTop: "auto", width: "100%" }} size="sm" onClick={() => startMutation.mutate({ caseId: c.id, timeLimit: c.time_limit_minutes ?? 20 })} disabled={startMutation.isPending}>开始训练</Button>
												)}
											</Paper>
										</motion.div>
									);
								})}
							</SimpleGrid>
							{total > LIMIT && <Pagination total={total} offset={offset} limit={LIMIT} onChange={setOffset} />}
						</>
					)}
				</Stack>
			)}

			{/* ═══ Tab: 我的作业 ═══ */}
			{tab === "assignments" && (
				!assignmentsData ? (
					<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
						{Array.from({ length: 3 }).map((_, i) => <LoadingSkeleton key={i} variant="card" />)}
					</SimpleGrid>
				) : assignments.length === 0 ? (
					<EmptyState icon={IconClipboardList} title="暂无作业" description="教师尚未布置作业，或所有作业已过期" />
				) : (
					<SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
						{assignments.map((a) => {
							const isExpired = a.end_time && new Date(a.end_time) < new Date();
							const isCompleted = a.status === "completed";
							const isInProgress = a.status === "in_progress";
							const attemptsLeft =
								a.max_attempts != null && a.max_attempts > 0
									? a.max_attempts - (a.attempt_count ?? 0)
									: null;

							const handleReattempt = async () => {
								if (isCompleted && a.score_total != null) {
									const ok = await confirm({
										title: "重新训练作业",
										message: `你已完成此作业（得分 ${a.score_total}），重新开始将创建一条新记录。确定继续？`,
										confirmLabel: "重新训练",
									});
									if (!ok) return;
								}
								handleStartAssignment(a.id);
							};

							return (
								<Paper
									key={a.id}
									withBorder
									radius="md"
									p="md"
									style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}
								>
									<Box>
										<Group justify="space-between" align="flex-start" gap="xs" wrap="nowrap">
											<Text size="sm" fw={600} truncate style={{ flex: 1 }}>{a.title}</Text>
											{isExpired && <Badge variant="light" color="red">已过期</Badge>}
											{isCompleted && <Badge variant="light" color="green">已完成</Badge>}
											{!isExpired && !isCompleted && <Badge variant="light" color="gray">待完成</Badge>}
										</Group>
										<Text size="xs" c="dimmed" mt={4}>
											{a.case_name}
											{a.score_total != null && <> · 得分 {a.score_total}</>}
										</Text>
										{(a.attempt_count ?? 0) > 0 && (
											<Text size="xs" c="dimmed" mt={2}>
												已尝试 {a.attempt_count} 次
												{attemptsLeft != null && <> · 剩余 {attemptsLeft} 次</>}
											</Text>
										)}
									</Box>
									<Box style={{ marginTop: "auto" }}>
										{isExpired ? (
											<Button size="sm" variant="outline" disabled style={{ width: "100%" }}>已过期</Button>
										) : isInProgress && a.record_id ? (
											<Button size="sm" style={{ width: "100%" }} onClick={() => navigate(`/training/${a.record_id}`)}><IconPlayerPlay size={14} />继续训练</Button>
										) : isCompleted ? (
											<Button size="sm" variant="outline" style={{ width: "100%" }} onClick={handleReattempt}><IconRotate size={14} />重新训练</Button>
										) : (
											<Button size="sm" style={{ width: "100%" }} onClick={() => handleStartAssignment(a.id)}><IconPlayerPlay size={14} />开始作业</Button>
										)}
									</Box>
								</Paper>
							);
						})}
					</SimpleGrid>
				)
			)}
		</Stack>
	);
}

/** 训练状态磁贴 — 数字 + 标签 + 轻提示色 */
function TrainingTile({
	icon,
	value,
	label,
	color,
	onClick,
}: {
	icon: ReactNode;
	value: number;
	label: string;
	color: "yellow" | "green" | "red";
	onClick: () => void;
}) {
	return (
		<UnstyledButton
			type="button"
			onClick={onClick}
			style={{ width: "100%", borderRadius: "var(--mantine-radius-md)", background: `var(--mantine-color-${color}-0)`, border: "1px solid var(--mantine-color-gray-2)", transition: "box-shadow 120ms ease" }}
		>
			<Stack gap={6} p="sm" align="flex-start" style={{ width: "100%" }}>
				{icon}
				<Text size="xl" fw={700} lh={1} className="tabular-nums">
					{value}
				</Text>
				<Text size="xs" c="dimmed">
					{label}
				</Text>
			</Stack>
		</UnstyledButton>
	);
}
