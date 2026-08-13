import { motion } from "motion/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, Button, Center, Group, Loader, Text, UnstyledButton } from "@mantine/core";
import { IconBell, IconEyeOff } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { components } from "@/api/api-types.gen";
import {
	getNotifications,
	markAllNotificationsRead,
	markNotificationRead,
	markNotificationUnread,
} from "@/api/notifications";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";

type TrainingNotificationItem = components["schemas"]["TrainingNotificationItem"];

const LIMIT = 20;

export default function NotificationBell() {
	const [open, setOpen] = useState(false);
	const [offset, setOffset] = useState(0);
	const [items, setItems] = useState<TrainingNotificationItem[]>([]);
	const qc = useQueryClient();
	const navigate = useNavigate();
	const { error: toastError } = useToast();
	const mutationLockRef = useRef(false);

	const { data, isLoading, isError } = useQuery({
		queryKey: queryKeys.notifications.list({ offset }),
		queryFn: () =>
			getNotifications({ unread_only: false, limit: LIMIT, offset }).then(
				(r) => r.data.items ?? [],
			),
		refetchInterval: 60_000,
		enabled: open,
	});

	useEffect(() => {
		if (!data) return;
		if (offset === 0) {
			setItems(data);
		} else {
			setItems((prev) => {
				const existing = new Set(prev.map((n) => n.id));
				const fresh = data.filter((n) => !existing.has(n.id));
				return [...prev, ...fresh];
			});
		}
	}, [data, offset]);

	const hasMore = (data?.length ?? 0) >= LIMIT;
	const unreadCount = items.filter((n) => !n.is_read).length;

	const updateItemInList = useCallback((id: number, is_read: boolean) => {
		setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read } : n)));
	}, []);

	const markOneReadMutation = useMutation({
		mutationFn: (id: number) => markNotificationRead(id),
		onMutate: (id) => {
			if (mutationLockRef.current) return;
			updateItemInList(id, true);
		},
		onError: (_err, id) => {
			toastError("标记已读失败");
			updateItemInList(id, false);
			qc.invalidateQueries({ queryKey: queryKeys.notifications.all });
		},
	});

	const markOneUnreadMutation = useMutation({
		mutationFn: (id: number) => markNotificationUnread(id),
		onMutate: (id) => {
			updateItemInList(id, false);
		},
		onError: (_err, id) => {
			toastError("标记未读失败");
			updateItemInList(id, true);
			qc.invalidateQueries({ queryKey: queryKeys.notifications.all });
		},
	});

	const markAllReadMutation = useMutation({
		mutationFn: () => markAllNotificationsRead(),
		onMutate: () => {
			mutationLockRef.current = true;
			setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
		},
		onError: () => {
			toastError("全部已读失败");
			qc.invalidateQueries({ queryKey: queryKeys.notifications.all });
		},
		onSettled: () => {
			mutationLockRef.current = false;
		},
	});

	const handleClick = useCallback(
		(n: TrainingNotificationItem) => {
			if (mutationLockRef.current) return;
			if (!n.is_read) {
				markOneReadMutation.mutate(n.id);
			}
			setOpen(false);
			if (n.type === "feedback_replied") {
				navigate("/my-feedback");
			} else if (n.type === "assignment_new") {
				navigate("/home");
			} else if (n.record_id) {
				navigate(`/record/${n.record_id}`);
			} else if (n.type === "scoring_complete" || n.type.startsWith("scoring_")) {
				navigate("/history");
			}
		},
		[navigate, markOneReadMutation],
	);

	return (
		<>
			<Button
				type="button"
				variant="subtle"
				color="gray"
				size="xs"
				w={32}
				h={32}
				p={0}
				onClick={() => setOpen(true)}
				aria-label={`通知${unreadCount > 0 ? `（${unreadCount} 条未读）` : ""}`}
				style={{ position: "relative" }}
			>
				<motion.div
					animate={unreadCount > 0 ? { scale: [1, 1.15, 1] } : { scale: 1 }}
					transition={unreadCount > 0 ? { repeat: Infinity, repeatDelay: 3, duration: 0.4 } : {}}
				>
					<IconBell size={16} />
				</motion.div>
				{unreadCount > 0 && (
					<motion.span
						initial={{ scale: 0 }}
						animate={{ scale: 1 }}
						style={{
							position: "absolute",
							top: -2,
							right: -2,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							width: 16,
							height: 16,
							fontSize: 10,
							fontWeight: 700,
							color: "white",
							background: "var(--mantine-color-red-6)",
							borderRadius: "50%",
						}}
					>
						{unreadCount > 99 ? "99+" : unreadCount}
					</motion.span>
				)}
			</Button>

			<ResponsiveDialog open={open} onClose={() => setOpen(false)} title="通知" maxWidth={400}>
				{isError ? (
					<Text size="sm" c="red" ta="center" py="lg">
						加载失败
					</Text>
				) : isLoading && items.length === 0 ? (
					<Center py="lg">
						<Loader size="sm" />
					</Center>
				) : items.length > 0 ? (
					<Box style={{ marginLeft: -16, marginRight: -16, marginBottom: -16 }}>
						<Box style={{ maxHeight: 288, overflowY: "auto" }}>
							{items.map((n, i) => (
								<Box
									key={n.id}
									style={{
										borderTop: i > 0 ? "1px solid var(--mantine-color-gray-3)" : undefined,
										opacity: n.is_read ? 0.5 : 1,
									}}
								>
									<UnstyledButton
										w="100%"
										ta="left"
										px="md"
										py="sm"
										onClick={() => handleClick(n)}
									>
										<Group gap={10} align="flex-start" wrap="nowrap">
											{!n.is_read && (
												<span
													style={{
														marginTop: 6,
														width: 8,
														height: 8,
														borderRadius: "50%",
														background: "var(--mantine-color-red-6)",
														flexShrink: 0,
													}}
												/>
											)}
											<Box style={{ minWidth: 0, flex: 1 }}>
												<Text size="sm" fw={500} style={{ lineHeight: 1.4 }}>
													{n.title}
												</Text>
												{n.body && (
													<Text size="xs" c="dimmed" mt={2} lineClamp={2}>
														{n.body}
													</Text>
												)}
												<Text fz={10} c="dimmed" mt={4} opacity={0.7}>
													{n.created_at.slice(0, 16).replace("T", " ")}
												</Text>
											</Box>
										</Group>
									</UnstyledButton>
									{n.is_read && (
										<Box px="md" pb="xs">
											<Button
												type="button"
												variant="transparent"
												size="xs"
												p={0}
												onClick={(e) => {
													e.stopPropagation();
													markOneUnreadMutation.mutate(n.id);
												}}
											>
												<IconEyeOff size={10} /> 标记未读
											</Button>
										</Box>
									)}
								</Box>
							))}
						</Box>
						<Group
							justify="space-between"
							px="md"
							py="xs"
							wrap="nowrap"
							style={{ borderTop: "1px solid var(--mantine-color-gray-3)" }}
						>
							<Button
								variant="subtle"
								color="gray"
								size="sm"
								onClick={() => {
									setOpen(false);
									navigate("/notifications");
								}}
							>
								查看全部
							</Button>
							<Group gap={4}>
								{unreadCount > 0 ? (
									<Button
										variant="subtle"
										color="gray"
										size="sm"
										onClick={() => markAllReadMutation.mutate()}
										disabled={mutationLockRef.current}
									>
										全部已读
									</Button>
								) : null}
								{hasMore && (
									<Button
										variant="subtle"
										color="gray"
										size="sm"
										onClick={() => setOffset((prev) => prev + LIMIT)}
									>
										加载更多
									</Button>
								)}
							</Group>
						</Group>
					</Box>
				) : (
					<Box py="lg" ta="center">
						<IconBell
							size={32}
							style={{
								color: "var(--mantine-color-dimmed)",
								opacity: 0.3,
								display: "block",
								margin: "0 auto 8px",
							}}
						/>
						<Text size="sm" c="dimmed">
							暂无通知
						</Text>
					</Box>
				)}
			</ResponsiveDialog>
		</>
	);
}
