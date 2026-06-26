import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, EyeOff, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import type { components } from "@/api/api-types.gen";
import {
	getNotifications,
	markAllNotificationsRead,
	markNotificationRead,
	markNotificationUnread,
} from "@/api/notifications";
import { useToast } from "@/components/Toast";
import { useApiQuery } from "@/hooks/useApiQuery";

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

	const { data, isLoading, isError } = useApiQuery({
		queryKey: ["notifications", { offset }],
		queryFn: () =>
			getNotifications({ unread_only: false, limit: LIMIT, offset }),
		refetchInterval: 60_000,
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
			qc.invalidateQueries({ queryKey: ["notifications"] });
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
			qc.invalidateQueries({ queryKey: ["notifications"] });
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
			qc.invalidateQueries({ queryKey: ["notifications"] });
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
			if (n.record_id) {
				navigate(`/record/${n.record_id}`);
			} else if (n.type === "scoring_complete" || n.type.startsWith("scoring_")) {
				navigate("/history");
			}
		},
		[navigate, markOneReadMutation],
	);

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="relative h-8 p-2 rounded-lg hover:bg-muted transition-colors"
				aria-label={`通知${unreadCount > 0 ? `（${unreadCount} 条未读）` : ""}`}
			>
				<Bell size={16} />
				{unreadCount > 0 && (
					<span className="absolute -top-0.5 -right-0.5 flex items-center justify-center size-4 text-[10px] font-bold text-white bg-destructive rounded-full">
						{unreadCount > 99 ? "99+" : unreadCount}
					</span>
				)}
			</button>

			{open &&
				createPortal(
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-xs"
						onClick={() => setOpen(false)}
					>
						<div
							className="w-full max-w-sm mx-4 bg-card rounded-xl shadow-e3 border border-border overflow-hidden"
							onClick={(e) => e.stopPropagation()}
						>
							<div className="flex items-center justify-between px-4 py-3 border-b">
								<span className="font-semibold text-sm">通知</span>
								<div className="flex items-center gap-2">
									{unreadCount > 0 && (
										<button
											type="button"
											onClick={() => markAllReadMutation.mutate()}
											disabled={mutationLockRef.current}
											className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
										>
											全部已读
										</button>
									)}
									<button
										type="button"
										onClick={() => setOpen(false)}
										className="size-9 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors"
									>
										<X size={16} />
									</button>
								</div>
							</div>
							<div className="max-h-80 overflow-y-auto">
								{isError ? (
									<div className="px-4 py-8 text-center text-sm text-destructive">加载失败，请稍后重试</div>
								) : isLoading && items.length === 0 ? (
									<div className="px-4 py-8 text-center text-sm text-muted-foreground">加载中…</div>
								) : items.length > 0 ? (
									<>
										{items.map((n) => (
											<div
												key={n.id}
												className={`border-b last:border-0 transition-colors ${
													n.is_read ? "opacity-60" : ""
												}`}
											>
												<button
													type="button"
													className="w-full text-left p-3 hover:bg-muted/50 transition-colors"
													onClick={() => handleClick(n)}
												>
													<div className="flex items-center gap-2">
														{!n.is_read && (
															<span className="size-2 rounded-full bg-destructive shrink-0" />
														)}
														<span className="text-sm font-medium flex-1">{n.title}</span>
													</div>
													{n.body && (
														<div className="text-xs text-muted-foreground mt-0.5">{n.body}</div>
													)}
													<div className="text-[10px] text-muted-foreground mt-1">
														{n.created_at.slice(0, 16).replace("T", " ")}
													</div>
												</button>
												{n.is_read && (
													<div className="px-3 pb-2">
														<button
															type="button"
															className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
															onClick={(e) => {
																e.stopPropagation();
																markOneUnreadMutation.mutate(n.id);
															}}
														>
															<EyeOff size={10} />
															标记未读
														</button>
													</div>
												)}
											</div>
										))}
										{hasMore && (
											<button
												type="button"
												className="w-full px-4 py-2.5 text-center text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
												onClick={() => setOffset((prev) => prev + LIMIT)}
											>
												加载更多
											</button>
										)}
									</>
								) : (
									<div className="px-4 py-8 text-center text-sm text-muted-foreground">暂无通知</div>
								)}
							</div>
						</div>
					</div>,
					document.body,
				)}
		</>
	);
}
