import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, EyeOff, X } from "lucide-react";
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
	const bellRef = useRef<HTMLButtonElement>(null);
	const dropdownRef = useRef<HTMLDivElement>(null);

	const { data, isLoading, isError } = useQuery({
		queryKey: queryKeys.notifications.list({ offset }),
		queryFn: () =>
			getNotifications({ unread_only: false, limit: LIMIT, offset }).then((r) => r.data),
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

	// Close on outside click
	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
				bellRef.current && !bellRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);

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
			} else if (n.record_id) {
				navigate(`/record/${n.record_id}`);
			} else if (n.type === "scoring_complete" || n.type.startsWith("scoring_")) {
				navigate("/history");
			}
		},
		[navigate, markOneReadMutation],
	);

	return (
		<div className="relative">
			<button
				ref={bellRef}
				type="button"
				onClick={() => setOpen(!open)}
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

			{open && (
				<div
					ref={dropdownRef}
					className="absolute right-0 top-full mt-1 w-80 max-h-[70vh] bg-card rounded-xl shadow-lg border border-border overflow-hidden z-50"
				>
					<div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/20">
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
								className="size-7 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors"
							>
								<X size={14} />
							</button>
						</div>
					</div>
					<div className="max-h-80 overflow-y-auto">
						{isError ? (
							<div className="px-4 py-8 text-center text-sm text-destructive">加载失败</div>
						) : isLoading && items.length === 0 ? (
							<div className="px-4 py-8 text-center text-sm text-muted-foreground">加载中…</div>
						) : items.length > 0 ? (
							<>
								{items.map((n) => (
									<div key={n.id} className={`border-b last:border-0 ${n.is_read ? "opacity-60" : ""}`}>
										<button
											type="button"
											className="w-full text-left p-2.5 hover:bg-muted/50 transition-colors"
											onClick={() => handleClick(n)}
										>
											<div className="flex items-center gap-2">
												{!n.is_read && <span className="size-1.5 rounded-full bg-destructive shrink-0" />}
												<span className="text-sm font-medium flex-1 truncate">{n.title}</span>
											</div>
											{n.body && (
												<div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</div>
											)}
											<div className="text-[10px] text-muted-foreground mt-0.5">
												{n.created_at.slice(0, 16).replace("T", " ")}
											</div>
										</button>
										{n.is_read && (
											<div className="px-2.5 pb-1.5">
												<button
													type="button"
													className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
													onClick={(e) => { e.stopPropagation(); markOneUnreadMutation.mutate(n.id); }}
												>
													<EyeOff size={10} /> 标记未读
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
			)}
		</div>
	);
}
