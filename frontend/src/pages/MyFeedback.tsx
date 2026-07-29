import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Camera, MessageSquare, MessageSquareReply } from "lucide-react";
import { useState } from "react";
import { feedbackImageUrl, getMyFeedback } from "@/api/admin/feedback";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import AuthImage from "@/components/ui/auth-image";
import Badge from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import EmptyState from "@/components/ui/empty-state";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import ProfileTabs from "@/components/shell/ProfileTabs";
import Pagination from "@/components/ui/pagination";
import PageHeader from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

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

	// 服务端过滤：tag / replied 与分页 total 同源，避免"过滤后空页"脱节
	const params: Record<string, unknown> = { offset, limit: LIMIT };
	if (tagFilter) params.tag = tagFilter;
	if (replyFilter === "replied") params.replied = true;
	else if (replyFilter === "unreplied") params.replied = false;

	const { data, isLoading } = useQuery({
		queryKey: queryKeys.admin.feedback.my(params),
		queryFn: () => getMyFeedback(params).then((r) => r.data),
		staleTime: 0,
		placeholderData: keepPreviousData,
		refetchOnWindowFocus: false,
	});

	const items = (data?.items ?? []) as FeedbackItem[];
	const total = data?.total ?? 0;
	const repliedCount = items.filter((item) => item.developer_reply).length;
	const pendingCount = Math.max(items.length - repliedCount, 0);


	const [previewUrl, setPreviewUrl] = useState<string | null>(null);

	return (
		<div className="mx-auto max-w-3xl space-y-5">
			<ProfileTabs />
			<PageHeader
				title="我的反馈"
				subtitle="查看已提交的问题、建议、截图与开发者回复"
				icon={MessageSquare}
			/>

			<section className="rounded-xl border border-border bg-card p-4">
				<div className="mb-4 grid grid-cols-3 gap-2 text-center">
					<div className="rounded-lg bg-muted/60 px-3 py-2">
						<div className="text-lg font-semibold text-foreground">{total}</div>
						<div className="text-xs text-muted-foreground">累计反馈</div>
					</div>
					<div className="rounded-lg bg-primary/10 px-3 py-2">
						<div className="text-lg font-semibold text-primary">{repliedCount}</div>
						<div className="text-xs text-muted-foreground">本页已回复</div>
					</div>
					<div className="rounded-lg bg-muted/60 px-3 py-2">
						<div className="text-lg font-semibold text-foreground">{pendingCount}</div>
						<div className="text-xs text-muted-foreground">本页待处理</div>
					</div>
				</div>

				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
						{TAG_OPTIONS.map((opt) => (
							<button
								key={opt.value}
								type="button"
								aria-pressed={tagFilter === opt.value}
								onClick={() => {
									setTagFilter(opt.value);
									setOffset(0);
								}}
								className={cn(
									"shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
									tagFilter === opt.value
										? "bg-primary text-primary-foreground"
										: "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
								)}
							>
								{opt.label}
							</button>
						))}
					</div>
					<label className="flex items-center gap-2 text-xs text-muted-foreground">
						回复状态
						<select
							value={replyFilter}
							onChange={(e) => {
								setReplyFilter(e.target.value);
								setOffset(0);
							}}
							className="h-8 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
						>
							<option value="">全部</option>
							<option value="replied">已回复</option>
							<option value="unreplied">未回复</option>
						</select>
					</label>
				</div>
			</section>

			{isLoading ? (
				<div className="space-y-3">
					{Array.from({ length: 3 }).map((_, i) => (
						<LoadingSkeleton key={i} variant="card" />
					))}
				</div>
			) : items.length === 0 ? (
				<EmptyState
					icon={MessageSquare}
					title="暂无反馈"
					description="你提交过的反馈、处理状态和开发者回复会显示在这里。"
				/>
			) : (
				<div className="space-y-3">
					{items.map((fb) => {
						const ratingIndex = Math.max(
							0,
							Math.min(RATING_LABELS.length - 1, fb.rating - 1),
						);
						return (
							<article
								key={fb.id}
								className="rounded-xl border border-border bg-card p-4"
							>
								<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
									<div className="flex flex-wrap items-center gap-2">
										<span
											className={cn(
												"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
												RATING_COLORS[ratingIndex],
											)}
										>
											<span>{fb.rating}</span>
											<span className="opacity-75">{RATING_LABELS[ratingIndex]}</span>
										</span>
										{fb.tag && (
											<Badge variant="outline" className="text-[10px]">
												{TAG_LABELS[fb.tag] || fb.tag}
											</Badge>
										)}
										<Badge
											variant={fb.developer_reply ? "success" : "neutral"}
											className="text-[10px]"
										>
											{fb.developer_reply ? "已回复" : "待处理"}
										</Badge>
									</div>
									<div className="shrink-0 text-xs text-muted-foreground">
										{new Date(fb.created_at).toLocaleString("zh-CN")}
										{fb.version && <span className="ml-2 opacity-60">v{fb.version}</span>}
									</div>
								</div>

								{fb.content && (
									<p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
										{fb.content}
									</p>
								)}

								{fb.image_ids && fb.image_ids.length > 0 && (
									<div className="mt-3 flex items-start gap-2">
										<Camera
											size={14}
											className="mt-1 shrink-0 text-muted-foreground"
										/>
										<div className="flex gap-2 overflow-x-auto pb-1">
											{fb.image_ids.map((imgId) => (
												<button
													type="button"
													key={imgId}
													onClick={() =>
														setPreviewUrl(feedbackImageUrl(fb.id, imgId))
													}
													className="shrink-0 overflow-hidden rounded-lg border border-border bg-muted transition-colors hover:border-primary"
												>
													<AuthImage
														src={feedbackImageUrl(fb.id, imgId)}
														alt={`反馈截图 ${imgId}`}
														className="h-16 w-24 object-cover"
													/>
												</button>
											))}
										</div>
									</div>
								)}

								{fb.developer_reply && (
									<div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3">
										<div className="mb-1 flex items-center gap-1.5">
											<MessageSquareReply size={13} className="text-primary" />
											<span className="text-xs font-medium text-primary">
												开发者回复
											</span>
											{fb.replied_at && (
												<span className="text-[10px] text-muted-foreground">
													{new Date(fb.replied_at).toLocaleString("zh-CN")}
												</span>
											)}
										</div>
										<p className="whitespace-pre-wrap text-sm leading-relaxed">
											{fb.developer_reply}
										</p>
									</div>
								)}
							</article>
						);
					})}
				</div>
			)}

			{total > LIMIT && (
				<Pagination
					total={total}
					offset={offset}
					limit={LIMIT}
					onChange={setOffset}
				/>
			)}

			{previewUrl && (
				<Dialog open onOpenChange={() => setPreviewUrl(null)}>
					<DialogContent title="截图预览" maxWidth={800}>
						<AuthImage
							src={previewUrl}
							alt="截图预览"
							className="max-h-[70vh] max-w-full rounded-md object-contain"
						/>
					</DialogContent>
				</Dialog>
			)}
		</div>
	);
}
