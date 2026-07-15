import { useQuery } from "@tanstack/react-query";
import { MessageSquare, MessageSquareReply } from "lucide-react";
import { getMyFeedback } from "@/api/admin/feedback";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import Badge from "@/components/ui/badge";
import EmptyState from "@/components/ui/empty-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import Pagination from "@/components/ui/pagination";
import { useState } from "react";
import { cn } from "@/utils/cn";

type Schemas = components["schemas"];
type FeedbackItem = Schemas["FeedbackItem"] & {
	developer_reply?: string | null;
	replied_at?: string | null;
	version?: string;
};

const RATING_LABELS = ["很不满意", "不满意", "一般", "满意", "很满意"];
const RATING_COLORS = [
	"text-red-600 bg-red-50",
	"text-orange-600 bg-orange-50",
	"text-amber-600 bg-amber-50",
	"text-emerald-600 bg-emerald-50",
	"text-green-600 bg-green-50",
];
const TAG_LABELS: Record<string, string> = {
	feature: "功能建议", bug: "BUG反馈", experience: "体验评价",
	content: "内容质量", ui: "界面设计", other: "其他",
};
const LIMIT = 20;

export default function MyFeedbackPage() {
	const [offset, setOffset] = useState(0);

	const { data, isLoading } = useQuery({
		queryKey: queryKeys.admin.feedback.my(offset),
		queryFn: () => getMyFeedback({ offset, limit: LIMIT }).then((r) => r.data),
		staleTime: 0,
		refetchOnWindowFocus: false,
	});

	const items = (data?.items ?? []) as FeedbackItem[];
	const total = data?.total ?? 0;

	return (
		<div className="space-y-6">
			<PageHeader title="我的反馈" icon={MessageSquare} />

			{isLoading ? (
				<div className="space-y-4">
					{Array.from({ length: 3 }).map((_, i) => <LoadingSkeleton key={i} variant="card" />)}
				</div>
			) : items.length === 0 ? (
				<EmptyState icon={MessageSquare} title="暂无反馈" description="你还没有提交过反馈意见" />
			) : (
				<div className="space-y-3">
					{items.map((fb) => (
						<div key={fb.id} className="rounded-xl border bg-card p-4 space-y-2">
							<div className="flex items-center justify-between gap-2">
								<div className="flex items-center gap-2">
									<span className={cn(
										"inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold",
										RATING_COLORS[fb.rating - 1] || "",
									)}>
										<span className="text-sm leading-none">{fb.rating}</span>
										<span className="text-[10px] opacity-70">{RATING_LABELS[fb.rating - 1]}</span>
									</span>
									{fb.tag && (
										<Badge variant="outline" className="text-[10px]">
											{TAG_LABELS[fb.tag] || fb.tag}
										</Badge>
									)}
								</div>
								<span className="text-xs text-muted-foreground">
									{new Date(fb.created_at).toLocaleString("zh-CN")}
									{fb.version && <span className="ml-2 opacity-60">v{fb.version}</span>}
								</span>
							</div>
							{fb.content && (
								<p className="text-sm text-muted-foreground leading-relaxed">{fb.content}</p>
							)}
						{fb.developer_reply && (
							<div className="mt-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
								<div className="flex items-center gap-1.5 mb-1">
									<MessageSquareReply size={13} className="text-primary" />
									<span className="text-xs font-medium text-primary">开发者回复</span>
									{fb.replied_at && (
										<span className="text-[10px] text-muted-foreground">
											{new Date(fb.replied_at).toLocaleString("zh-CN")}
										</span>
									)}
								</div>
								<p className="text-sm leading-relaxed">{fb.developer_reply}</p>
							</div>
						)}
						</div>
					))}
				</div>
			)}

			{total > LIMIT && (
				<Pagination total={total} offset={offset} limit={LIMIT} onChange={setOffset} />
			)}
		</div>
	);
}
