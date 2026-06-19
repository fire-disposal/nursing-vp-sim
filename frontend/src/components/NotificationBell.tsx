import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/axios-instance";

interface Notification {
	id: number;
	type: string;
	title: string;
	body: string;
	created_at: string;
}

export default function NotificationBell() {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const qc = useQueryClient();
	const navigate = useNavigate();

	const { data } = useQuery({
		queryKey: ["notifications"],
		queryFn: () => api.get<Notification[]>("/training/notifications"),
		refetchInterval: 30_000,
	});

	const markReadMutation = useMutation({
		mutationFn: (id: number) => api.patch(`/training/notifications/${id}`),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["notifications"] });
		},
	});

	const notifications: Notification[] = data?.data ?? [];
	const unread = notifications.length;

	useEffect(() => {
		const handleClick = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, []);

	const handleClick = useCallback(
		(n: Notification) => {
			markReadMutation.mutate(n.id);
			setOpen(false);
			if (n.type === "scoring_complete" || n.type.startsWith("scoring_")) {
				navigate("/history");
			}
		},
		[markReadMutation, navigate],
	);

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen(!open)}
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
			{open && notifications.length > 0 && (
				<div className="absolute right-0 top-full mt-2 w-72 bg-card border border-border rounded-xl shadow-lg z-50 max-h-80 overflow-y-auto">
					<div className="px-3 py-2.5 border-b text-sm font-semibold">通知</div>
					{notifications.map((n) => (
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
					))}
				</div>
			)}
			{open && notifications.length === 0 && (
				<div className="absolute right-0 top-full mt-2 w-72 bg-card border border-border rounded-xl shadow-lg z-50">
					<div className="px-3 py-2.5 text-center text-sm text-muted-foreground">暂无通知</div>
				</div>
			)}
		</div>
	);
}
