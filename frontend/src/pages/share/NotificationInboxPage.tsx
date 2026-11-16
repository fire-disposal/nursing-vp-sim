import { Box, Button, Container, Group, Paper, Skeleton, Stack, Text, } from "@mantine/core";
import { IconBell, } from "@tabler/icons-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { components } from "@/api/api-types.gen";
import {
	getNotifications,
	markAllNotificationsRead,
	markNotificationRead,
	markNotificationUnread,
} from "@/api/notifications";
import { queryKeys } from "@/api/query-keys";
import { NOTIFICATION_TYPE_LABELS, NotificationRow } from "@/components/notifications/NotificationRow";
import ProfileTabs from "@/components/shell/ProfileTabs";
import { useToast } from "@/components/Toast";
import EmptyState from "@/components/ui/empty-state";
import PageHeader from "@/components/ui/page-header";
import Pagination from "@/components/ui/pagination";
import { openNotification } from "@/utils/training-nav";

type TrainingNotificationItem = components["schemas"]["TrainingNotificationItem"];

const LIMIT = 20;

export default function NotificationInboxPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const offsetParam = Number(searchParams.get("offset") || "0");
	const offset = Math.max(0, offsetParam - (offsetParam % LIMIT));
	const typeFilter = searchParams.get("type") || "";
	const unreadOnly = searchParams.get("unread") === "1";
	const qc = useQueryClient();
	const navigate = useNavigate();
	const location = useLocation();
	// 通知里点进训练也要记来源：训练壳出口才能回到通知中心
	const trainingFrom = location.pathname + location.search;
	const { error: toastError } = useToast();

	const { data, isLoading, isError } = useQuery({
		queryKey: queryKeys.notifications.list({ offset, limit: LIMIT, type: typeFilter, unreadOnly }),
		queryFn: () =>
			getNotifications({
				unread_only: unreadOnly,
				limit: LIMIT,
				offset,
				type: typeFilter || undefined,
			}).then((r) => r.data),
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

	const setUnreadOnly = (next: boolean) => {
		setSearchParams((prev) => {
			const params = new URLSearchParams(prev);
			if (next) params.set("unread", "1");
			else params.delete("unread");
			params.delete("offset");
			return params;
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
					<Button
						type="button"
						variant={unreadOnly ? "filled" : "light"}
						color={unreadOnly ? undefined : "gray"}
						size="sm"
						radius="md"
						onClick={() => setUnreadOnly(!unreadOnly)}
						style={{ flexShrink: 0 }}
					>
						只看未读
					</Button>
					{TYPES.map((t) => (
						<Button
							key={t}
							type="button"
							variant={!unreadOnly && typeFilter === t ? "filled" : "light"}
							color={!unreadOnly && typeFilter === t ? undefined : "gray"}
							size="sm"
							radius="md"
							onClick={() => setType(t)}
							style={{ flexShrink: 0 }}
						>
							{t ? (NOTIFICATION_TYPE_LABELS[t] ?? t) : "全部"}
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
					<Paper withBorder style={{ overflow: "hidden" }}>
						{items.map((n, i) => (
							<Box
								key={n.id}
								style={{ borderTop: i > 0 ? "1px solid var(--mantine-color-default-border)" : undefined }}
							>
								<NotificationRow
									item={n}
									onOpen={() => handleClick(n)}
									onToggleRead={() =>
										n.is_read ? markOneUnreadMutation.mutate(n.id) : markOneReadMutation.mutate(n.id)
									}
								/>
							</Box>
						))}
					</Paper>
				) : (
					<EmptyState
						icon={IconBell}
						title={unreadOnly ? "没有未读通知" : typeFilter ? "该类型暂无通知" : "暂无通知"}
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
