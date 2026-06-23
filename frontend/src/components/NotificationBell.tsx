import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, X } from "lucide-react";
import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/axios-instance";
import { useToast } from "@/components/Toast";
import { useApiQuery } from "@/hooks/useApiQuery";

interface Notification {
	id: number;
	type: string;
	title: string;
	body: string;
	record_id?: number;
	created_at: string;
}

export default function NotificationBell() {
	const [open, setOpen] = useState(false);
	const qc = useQueryClient();
	const navigate = useNavigate();
	const { error: toastError } = useToast();

	const { data } = useApiQuery({
		queryKey: ["notifications"],
		queryFn: () => api.get<Notification[]>("/training/notifications"),
		refetchInterval: 30_000,
	});

	const markOneReadMutation = useMutation({
		mutationFn: (id: number) => api.patch(`/training/notifications/${id}`),
		onMutate: (id) => {
			qc.setQueryData<Notification[]>(["notifications"], (prev) =>
				(prev ?? []).filter((n) => n.id !== id),
			);
		},
		onError: () => {
			toastError("标记已读失败");
			qc.invalidateQueries({ queryKey: ["notifications"] });
		},
	});

	const markAllReadMutation = useMutation({
		mutationFn: () => api.patch("/training/notifications/read-all"),
		onMutate: () => {
			qc.setQueryData<Notification[]>(["notifications"], []);
		},
		onError: () => {
			toastError("标记已读失败");
			qc.invalidateQueries({ queryKey: ["notifications"] });
		},
	});

	const notifications: Notification[] = data ?? [];
	const unread = notifications.length;

	const handleClick = useCallback(
		(n: Notification) => {
			markOneReadMutation.mutate(n.id);
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
				aria-label={`通知${unread > 0 ? `（${unread} 条未读）` : ""}`}
			>
				<Bell size={16} />
				{unread > 0 && (
					<span className="absolute -top-0.5 -right-0.5 flex items-center justify-center size-4 text-[10px] font-bold text-white bg-destructive rounded-full">
						{unread > 9 ? "9+" : unread}
					</span>
				)}
			</button>

			{open &&
				createPortal(
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
						onClick={() => setOpen(false)}
					>
						<div
							className="w-full max-w-sm mx-4 bg-card rounded-xl shadow-xl border border-border overflow-hidden"
							onClick={(e) => e.stopPropagation()}
						>
							<div className="flex items-center justify-between px-4 py-3 border-b">
								<span className="font-semibold text-sm">通知</span>
								<div className="flex items-center gap-2">
									{unread > 0 && (
										<button
											type="button"
											onClick={() => markAllReadMutation.mutate()}
											className="text-xs text-muted-foreground hover:text-foreground transition-colors"
										>
											全部已读
										</button>
									)}
									<button
										type="button"
										onClick={() => setOpen(false)}
										className="p-1 rounded-md hover:bg-muted transition-colors"
									>
										<X size={16} />
									</button>
								</div>
							</div>
							<div className="max-h-80 overflow-y-auto">
								{notifications.length > 0 ? (
									notifications.map((n) => (
										<button
											type="button"
											key={n.id}
											className="w-full text-left p-3 border-b last:border-0 hover:bg-muted/50 transition-colors"
											onClick={() => handleClick(n)}
										>
											<div className="text-sm font-medium">{n.title}</div>
											<div className="text-xs text-muted-foreground mt-0.5">{n.body}</div>
											<div className="text-[10px] text-muted-foreground mt-1">{n.created_at.slice(0, 10)}</div>
										</button>
									))
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
