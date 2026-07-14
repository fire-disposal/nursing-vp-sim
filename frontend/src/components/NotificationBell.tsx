import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, EyeOff } from "lucide-react";
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
import Button from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

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
			getNotifications({ unread_only: false, limit: LIMIT, offset }).then((r) => r.data),
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

			<Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
				<DialogContent title="通知" maxWidth={400} className="p-4">
					{isError ? (
						<div className="py-10 text-center text-sm text-destructive">加载失败</div>
					) : isLoading && items.length === 0 ? (
						<div className="py-10 text-center">
							<div className="mx-auto size-6 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
						</div>
					) : items.length > 0 ? (
						<div className="-mx-4 -mb-4">
							<div className="max-h-72 overflow-y-auto">
								{items.map((n, i) => (
									<div
										key={n.id}
										className={`${i > 0 ? "border-t" : ""} ${n.is_read ? "opacity-50" : ""}`}
									>
										<button
											type="button"
											className="w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors"
											onClick={() => handleClick(n)}
										>
											<div className="flex items-start gap-2.5">
												{!n.is_read && (
													<span className="mt-1.5 size-2 rounded-full bg-destructive shrink-0" />
												)}
												<div className="min-w-0 flex-1">
													<div className="text-sm font-medium leading-snug">{n.title}</div>
													{n.body && (
														<div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</div>
													)}
													<div className="text-[10px] text-muted-foreground/70 mt-1">
														{n.created_at.slice(0, 16).replace("T", " ")}
													</div>
												</div>
											</div>
										</button>
										{n.is_read && (
											<div className="px-4 pb-2">
												<button
													type="button"
													className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 hover:text-foreground transition-colors"
													onClick={(e) => { e.stopPropagation(); markOneUnreadMutation.mutate(n.id); }}
												>
													<EyeOff size={10} /> 标记未读
												</button>
											</div>
										)}
									</div>
								))}
							</div>
							<div className="flex items-center justify-between border-t px-4 py-2">
								{unreadCount > 0 ? (
									<Button variant="ghost" size="sm" className="text-xs h-7"
										onClick={() => markAllReadMutation.mutate()}
										disabled={mutationLockRef.current}>
										全部已读
									</Button>
								) : <div />}
								{hasMore && (
									<Button variant="ghost" size="sm" className="text-xs h-7"
										onClick={() => setOffset((prev) => prev + LIMIT)}>
										加载更多
									</Button>
								)}
							</div>
						</div>
					) : (
						<div className="py-10 text-center text-sm text-muted-foreground">暂无通知</div>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}