import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, EyeOff } from "lucide-react";
import { useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import PageHeader from "@/components/ui/page-header";
import Pagination from "@/components/ui/pagination";
import { cn } from "@/utils/cn";

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
		<div className="space-y-6 max-w-3xl mx-auto">
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

			<div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
				{TYPES.map((t) => (
					<button
						key={t}
						type="button"
						onClick={() => setType(t)}
						className={cn(
							"shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap",
							typeFilter === t
								? "bg-primary text-primary-foreground"
								: "bg-muted text-muted-foreground hover:bg-muted/80",
						)}
					>
						{t ? (TYPE_LABELS[t] ?? t) : "全部"}
					</button>
				))}
			</div>

			{isError ? (
				<div className="py-16 text-center text-sm text-destructive">加载失败</div>
			) : isLoading ? (
				<div className="space-y-2">
					{[...Array(5)].map((_, i) => (
						<div key={i} className="rounded-lg border bg-card p-4 animate-pulse">
							<div className="h-4 bg-muted rounded w-3/4 mb-2" />
							<div className="h-3 bg-muted rounded w-1/2" />
						</div>
					))}
				</div>
			) : items.length > 0 ? (
				<div className="space-y-1">
					{items.map((n) => (
						<button
							key={n.id}
							type="button"
							className={cn(
								"w-full text-left rounded-lg border bg-card p-4 hover:bg-muted/40 transition-colors",
								!n.is_read && "border-l-2 border-l-primary",
							)}
							onClick={() => handleClick(n)}
						>
							<div className="flex items-start gap-3">
								{!n.is_read && (
									<span className="mt-1.5 size-2 rounded-full bg-primary shrink-0" />
								)}
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2 mb-1">
										<span className="text-[10px] px-1.5 py-px rounded bg-muted text-muted-foreground font-medium">
											{TYPE_LABELS[n.type] ?? n.type}
										</span>
										<span className="text-[11px] text-muted-foreground/60">
											{n.created_at.slice(0, 16).replace("T", " ")}
										</span>
									</div>
									<div className="text-sm font-medium leading-snug">{n.title}</div>
									{n.body && (
										<div className="text-xs text-muted-foreground mt-1 line-clamp-2">
											{n.body}
										</div>
									)}
								</div>
								{n.is_read && (
									<button
										type="button"
										className="shrink-0 p-1 rounded hover:bg-muted transition-colors"
										onClick={(e) => {
											e.stopPropagation();
											markOneUnreadMutation.mutate(n.id);
										}}
										title="标记未读"
									>
										<EyeOff size={13} className="text-muted-foreground" />
									</button>
								)}
							</div>
						</button>
					))}
				</div>
			) : (
				<div className="py-16 text-center">
					<Bell size={40} className="text-muted-foreground/20 mx-auto mb-3" />
					<span className="text-sm text-muted-foreground">
						{typeFilter ? "该类型暂无通知" : "暂无通知"}
					</span>
				</div>
			)}

			<Pagination
				total={total}
				offset={offset}
				limit={LIMIT}
				onChange={setOffset}
				className="mt-6"
			/>
		</div>
	);
}
