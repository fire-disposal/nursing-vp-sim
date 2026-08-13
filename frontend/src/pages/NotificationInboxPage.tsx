import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionIcon, Badge, Box, Container, Group, Paper, Skeleton, Stack, Text } from "@mantine/core";
import { IconBell, IconEyeOff } from "@tabler/icons-react";
import EmptyState from "@/components/ui/empty-state";
import { useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import Button from "@/components/ui/button";
import PageHeader from "@/components/ui/page-header";
import Pagination from "@/components/ui/pagination";

type TrainingNotificationItem = components["schemas"]["TrainingNotificationItem"];

const LIMIT = 20;

const TYPE_LABELS: Record<string, string> = {
	assignment_new: "新作业",
	scoring_complete: "评分完成",
	scoring_failed: "评分失败",
	feedback_replied: "反馈回复",
	system: "系统通知",
	reminder: "催交提醒",
};

export default function NotificationInboxPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const offsetParam = Number(searchParams.get("offset") || "0");
	const offset = Math.max(0, offsetParam - (offsetParam % LIMIT));
	const typeFilter = searchParams.get("type") || "";
	const qc = useQueryClient();
	const navigate = useNavigate();
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
			if (n.type === "feedback_replied") {
				navigate("/my-feedback");
			} else if (n.type === "assignment_new" || n.type === "reminder") {
				navigate("/home");
			} else if (n.record_id) {
				navigate(`/record/${n.record_id}`);
			} else if (n.type === "scoring_complete" || n.type.startsWith("scoring_")) {
				navigate("/history");
			}
		},
		[navigate, markOneReadMutation],
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

	const TYPES = ["", "assignment_new", "scoring_complete", "feedback_replied", "reminder", "system"];

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
							variant={typeFilter === t ? "default" : "secondary"}
							size="xs"
							radius="xl"
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
							<Paper key={i} withBorder radius="md" p="md">
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
								radius="md"
								p="md"
								onClick={() => handleClick(n)}
								style={{
									cursor: "pointer",
									textAlign: "left",
									borderLeft: n.is_read ? undefined : "2px solid var(--mantine-color-teal-6)",
								}}
							>
								<Group gap="sm" align="flex-start" wrap="nowrap">
									{!n.is_read && (
										<Box
											w={8}
											h={8}
											bg="teal"
											style={{ borderRadius: "50%", flexShrink: 0, marginTop: 6 }}
										/>
									)}
									<Box style={{ minWidth: 0, flex: 1 }}>
										<Group gap="xs" mb={4}>
											<Badge variant="secondary" size="xs">
												{TYPE_LABELS[n.type] ?? n.type}
											</Badge>
											<Text size="11px" c="dimmed" opacity={0.6}>
												{n.created_at.slice(0, 16).replace("T", " ")}
											</Text>
										</Group>
										<Text size="sm" fw={500} lh={1.35}>
											{n.title}
										</Text>
										{n.body && (
											<Text size="xs" c="dimmed" mt={4} lineClamp={2}>
												{n.body}
											</Text>
										)}
									</Box>
									{n.is_read && (
										<ActionIcon
											variant="subtle"
											color="gray"
											title="标记未读"
											onClick={(e) => {
												e.stopPropagation();
												markOneUnreadMutation.mutate(n.id);
											}}
										>
											<IconEyeOff size={13} />
										</ActionIcon>
									)}
								</Group>
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
