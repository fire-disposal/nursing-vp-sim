import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Badge, Box, Button, Container, Group, Paper, Skeleton, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconBell, IconEyeOff } from "@tabler/icons-react";
import EmptyState from "@/components/ui/empty-state";
import { useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { components } from "@/api/api-types.gen";
import {
	getNotifications,
	markAllNotificationsRead,
	markNotificationRead,
	markNotificationUnread,
} from "@/api/notifications";
import ProfileTabs from "@/components/shell/ProfileTabs";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import PageHeader from "@/components/ui/page-header";
import Pagination from "@/components/ui/pagination";
import { openNotification } from "@/utils/training-nav";
// 时间统一走 utils/date：手拼 slice 会把 UTC 串直接显示成"本地时间"，与页面其他时间差 8 小时
import { formatShortDateTime } from "@/utils/date";

type TrainingNotificationItem = components["schemas"]["TrainingNotificationItem"];

const LIMIT = 20;

const TYPE_LABELS: Record<string, string> = {
	assignment_new: "新作业",
	scoring_complete: "评分完成",
	scoring_failed: "评分失败",
	feedback_replied: "反馈回复",
	system: "系统通知",
};

export default function NotificationInboxPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const offsetParam = Number(searchParams.get("offset") || "0");
	const offset = Math.max(0, offsetParam - (offsetParam % LIMIT));
	const typeFilter = searchParams.get("type") || "";
	const qc = useQueryClient();
	const navigate = useNavigate();
	const location = useLocation();
	// 通知里点进训练也要记来源：训练壳出口才能回到通知中心
	const trainingFrom = location.pathname + location.search;
	const { error: toastError } = useToast();

	const { data, isLoading, isError } = useQuery({
		queryKey: queryKeys.notifications.list({ offset, limit: LIMIT, type: typeFilter }),
		queryFn: () =>
			getNotifications({ unread_only: false, limit: LIMIT, offset, type: typeFilter || undefined }).then(
				(r) => r.data,
			),
		placeholderData: keepPreviousData,
	});

	const items = data?.items ?? [];
	const total = data?.total ?? 0;

	const markOneReadMutation = useMutation({
		mutationFn: (id: number) => markNotificationRead(id),
		onError: () => {
			toastError("标记已读失败");
			qc.invalidateQueries({ queryKey: queryKeys.notifications.all });
		},
	});

	const markOneUnreadMutation = useMutation({
		mutationFn: (id: number) => markNotificationUnread(id),
		onError: () => {
			toastError("标记未读失败");
			qc.invalidateQueries({ queryKey: queryKeys.notifications.all });
		},
	});

	const markAllReadMutation = useMutation({
		mutationFn: () => markAllNotificationsRead(),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: queryKeys.notifications.all });
		},
		onError: () => toastError("全部已读失败"),
	});

	const handleClick = useCallback(
		(n: TrainingNotificationItem) => {
			if (!n.is_read) {
				markOneReadMutation.mutate(n.id);
			}
			openNotification(navigate, n, trainingFrom);
		},
		[navigate, markOneReadMutation, trainingFrom],
	);

	const setOffset = (newOffset: number) => {
		setSearchParams((prev) => {
			const next = new URLSearchParams(prev);
			if (newOffset > 0) next.set("offset", String(newOffset));
			else next.delete("offset");
			return next;
		});
	};

	const setType = (t: string) => {
		setSearchParams((prev) => {
			const next = new URLSearchParams(prev);
			if (t) next.set("type", t);
			else next.delete("type");
			next.delete("offset");
			return next;
		});
	};

	const TYPES = ["", "assignment_new", "scoring_complete", "feedback_replied", "system"];

	return (
		<Container size="md" py="md">
			<Stack gap="lg">
				<ProfileTabs />
				<PageHeader
					title="通知中心"
					subtitle={total > 0 ? `共 ${total} 条通知` : "暂无通知"}
					actions={
						items.some((n) => !n.is_read) ? (
							<Button
								variant="outline"
								size="sm"
								onClick={() => markAllReadMutation.mutate()}
								disabled={markAllReadMutation.isPending}
							>
								全部已读
							</Button>
						) : null
					}
				/>

				<Group gap={6} wrap="nowrap" style={{ overflowX: "auto" }}>
					{TYPES.map((t) => (
						<Button
							key={t}
							type="button"
							variant={typeFilter === t ? "filled" : "light"} color={typeFilter === t ? undefined : "gray"}
							size="xs"
							radius="md"
							onClick={() => setType(t)}
							style={{ flexShrink: 0 }}
						>
							{t ? (TYPE_LABELS[t] ?? t) : "全部"}
						</Button>
					))}
				</Group>

				{isError ? (
					<Text ta="center" c="red" py={64} size="sm">
						加载失败
					</Text>
				) : isLoading ? (
					<Stack gap="xs">
						{[...Array(5)].map((_, i) => (
							<Paper key={i} withBorder p="md">
								<Skeleton height={16} width="75%" mb="xs" />
								<Skeleton height={12} width="50%" />
							</Paper>
						))}
					</Stack>
				) : items.length > 0 ? (
					<Stack gap={4}>
						{items.map((n) => (
							<Paper
								key={n.id}
								withBorder
								style={{
									display: "flex",
									alignItems: "flex-start",
									// 未读蓝条留在容器上：按钮只承担可点击区域，焦点环不会盖住这条语义标记
									borderLeft: n.is_read ? undefined : "2px solid var(--mantine-color-blue-6)",
								}}
							>
								{/* 用真按钮而不是给 Paper 挂 onClick：键盘用户才能 Tab 聚焦、Enter/Space 打开通知 */}
								<UnstyledButton
									onClick={() => handleClick(n)}
									aria-label={`${TYPE_LABELS[n.type] ?? n.type}：${n.title}${n.is_read ? "" : "（未读）"}`}
									style={{
										flex: 1,
										minWidth: 0,
										textAlign: "left",
										padding: "var(--mantine-spacing-md)",
									}}
								>
									<Group gap="sm" align="flex-start" wrap="nowrap">
										{!n.is_read && (
											<Box
												w={8}
												h={8}
												bg="blue"
												style={{ borderRadius: "50%", flexShrink: 0, marginTop: 6 }}
											/>
										)}
										<Box style={{ minWidth: 0, flex: 1 }}>
											<Group gap="xs" mb={4}>
												<Badge variant="light" color="gray" size="xs">
													{TYPE_LABELS[n.type] ?? n.type}
												</Badge>
												<Text size="11px" c="dimmed" opacity={0.6}>
													{formatShortDateTime(n.created_at)}
												</Text>
											</Group>
											<Text size="sm" fw={500} lh={1.35} style={{ overflowWrap: "anywhere" }}>
												{n.title}
											</Text>
											{n.body && (
												<Text size="xs" c="dimmed" mt={4} lineClamp={2}>
													{n.body}
												</Text>
											)}
										</Box>
									</Group>
								</UnstyledButton>
								{/* 标记未读放在按钮**外层**：按钮不能嵌套按钮，否则内层点击会连带触发导航 */}
								{n.is_read && (
									<Box py="md" pr="md" pl="xs" style={{ flexShrink: 0 }}>
										<ActionIcon
											variant="subtle"
											color="gray"
											aria-label="标记为未读"
											title="标记为未读"
											onClick={(e) => {
												e.stopPropagation();
												markOneUnreadMutation.mutate(n.id);
											}}
										>
											<IconEyeOff size={13} />
										</ActionIcon>
									</Box>
								)}
							</Paper>
						))}
					</Stack>
				) : (
					<EmptyState
						icon={IconBell}
						title={typeFilter ? "该类型暂无通知" : "暂无通知"}
					/>
				)}

				<Pagination
					total={total}
					offset={offset}
					limit={LIMIT}
					onChange={setOffset}
				/>
			</Stack>
		</Container>
	);
}
