import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Camera, MessageSquare, MessageSquareReply } from "lucide-react";
import { useMemo, useState } from "react";
import { feedbackImageUrl, getMyFeedback } from "@/api/admin/feedback";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import AuthImage from "@/components/ui/auth-image";
import Badge from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import EmptyState from "@/components/ui/empty-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import PageHeader from "@/components/ui/page-header";
import Pagination from "@/components/ui/pagination";
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

const TAG_OPTIONS = [
	{ label: "全部", value: "" },
	{ label: "BUG", value: "bug" },
	{ label: "功能", value: "feature" },
	{ label: "体验", value: "experience" },
	{ label: "内容", value: "content" },
	{ label: "UI", value: "ui" },
	{ label: "其他", value: "other" },
];

export default function MyFeedbackPage() {
	const [offset, setOffset] = useState(0);
	const [tagFilter, setTagFilter] = useState("");
	const [replyFilter, setReplyFilter] = useState("");

	const { data, isLoading } = useQuery({
		queryKey: queryKeys.admin.feedback.my(offset),
		queryFn: () => getMyFeedback({ offset, limit: LIMIT }).then((r) => r.data),
		staleTime: 0,
		placeholderData: keepPreviousData,
		refetchOnWindowFocus: false,
	});

	const rawItems = (data?.items ?? []) as FeedbackItem[];
	const total = data?.total ?? 0;

	const items = useMemo(() => {
		let result = rawItems;
		if (tagFilter) {
			result = result.filter((fb) => fb.tag === tagFilter);
		}
		if (replyFilter === "replied") {
			result = result.filter((fb) => fb.developer_reply != null);
		} else if (replyFilter === "unreplied") {
			result = result.filter((fb) => fb.developer_reply == null);
		}
		return result;
	}, [rawItems, tagFilter, replyFilter]);

	const [previewUrl, setPreviewUrl] = useState<string | null>(null);

	return (
		<div className="space-y-6">
			<PageHeader title="我的反馈" icon={MessageSquare} />

			<div className="flex flex-wrap items-center gap-3 mb-4">
				<div className="flex gap-1.5 flex-wrap">
					{TAG_OPTIONS.map((opt) => (
						<button
							key={opt.value}
							onClick={() => { setTagFilter(opt.value); setOffset(0); }}
							className={cn(
								"px-3 py-1 rounded-full border text-sm cursor-pointer transition-colors",
								tagFilter === opt.value
									? "bg-primary text-primary-foreground border-primary"
									: "border-border bg-card text-muted-foreground hover:border-primary hover:text-primary",
							)}
						>
							{opt.label}
						</button>
					))}
				</div>
				<select
					value={replyFilter}
					onChange={(e) => { setReplyFilter(e.target.value); setOffset(0); }}
					className="py-1.5 px-2.5 border border-border rounded-lg text-sm bg-card"
				>
					<option value="">全部</option>
					<option value="replied">已回复</option>
					<option value="unreplied">未回复</option>
				</select>
			</div>

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
							{fb.image_ids && fb.image_ids.length > 0 && (
								<div className="flex items-center gap-1.5 mt-2">
									<Camera size={13} className="text-muted-foreground shrink-0" />
									<div className="flex gap-1.5 overflow-x-auto pb-1">
										{fb.image_ids.map((imgId) => (
											<button
												type="button"
												key={imgId}
												onClick={() => setPreviewUrl(feedbackImageUrl(fb.id, imgId))}
												className="shrink-0 rounded-md border border-border overflow-hidden hover:border-primary transition-colors cursor-pointer"
											>
												<AuthImage
													src={feedbackImageUrl(fb.id, imgId)}
													alt={`截图 ${imgId}`}
													className="h-16 w-auto object-cover"
												/>
											</button>
										))}
									</div>
								</div>
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

			{previewUrl && (
				<Dialog open onOpenChange={() => setPreviewUrl(null)}>
					<DialogContent title="截图预览" maxWidth={800}>
						<AuthImage src={previewUrl} alt="截图预览" className="max-w-full max-h-[70vh] object-contain rounded-md" />
					</DialogContent>
				</Dialog>
			)}
		</div>
	);
}
