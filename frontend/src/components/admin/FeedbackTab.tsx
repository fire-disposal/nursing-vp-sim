import { useQuery } from "@tanstack/react-query";
import {
	BarChart3,
	ChevronLeft,
	ChevronRight,
	MessageSquare,
} from "lucide-react";
import { useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Legend,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { getFeedbackStats, getFeedbacks, replyFeedback } from "@/api";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import { ChartTooltip } from "@/components/ui/chart-tooltip";
import EmptyState from "@/components/ui/empty-state";
import LoadingState from "@/components/ui/loading-state";
import Pagination from "@/components/ui/pagination";
import { cn } from "@/utils/cn";

type Schemas = components["schemas"];
type FeedbackDailyItem = Schemas["FeedbackDailyItem"];
type FeedbackItem = Schemas["FeedbackItem"] & {
	developer_reply?: string | null;
	replied_at?: string | null;
	version?: string;
};

const TAG_OPTIONS = [
	{ label: "全部", value: "" },
	{ label: "功能建议", value: "feature" },
	{ label: "BUG反馈", value: "bug" },
	{ label: "体验评价", value: "experience" },
	{ label: "内容质量", value: "content" },
	{ label: "界面设计", value: "ui" },
	{ label: "其他", value: "other" },
];

const TAG_VARIANT: Record<
	string,
	"info" | "danger" | "success" | "warning" | "neutral"
> = {
	feature: "info",
	bug: "danger",
	experience: "success",
	content: "warning",
	ui: "info",
	other: "neutral",
};

const TAG_LABEL: Record<string, string> = {
	feature: "功能建议",
	bug: "BUG反馈",
	experience: "体验评价",
	content: "内容质量",
	ui: "界面设计",
	other: "其他",
};

const RATING_LABELS = ["很不满意", "不满意", "一般", "满意", "很满意"];
const RATING_COLORS = [
	"text-red-600 bg-red-50 border-red-200",
	"text-orange-600 bg-orange-50 border-orange-200",
	"text-amber-600 bg-amber-50 border-amber-200",
	"text-emerald-600 bg-emerald-50 border-emerald-200",
	"text-green-600 bg-green-50 border-green-200",
];

const PIE_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6"];

function FeedbackRow({ fb, onReplied }: { fb: FeedbackItem; onReplied: () => void }) {
	const [replyOpen, setReplyOpen] = useState(false);
	const [replyText, setReplyText] = useState("");
	const [sending, setSending] = useState(false);
	const toast = useToast();

	const handleReply = async () => {
		if (!replyText.trim()) return;
		setSending(true);
		try {
			await replyFeedback(fb.id, replyText.trim());
			toast.success("回复已发送");
			setReplyText("");
			setReplyOpen(false);
			onReplied();
		} catch {
			toast.error("回复失败");
		} finally {
			setSending(false);
		}
	};

	return (
		<div className="py-2.5 px-3.5 border border-border rounded-lg bg-card">
			<div className="flex items-center justify-between mb-1">
				<div className="flex items-center gap-2">
					<span className={cn(
						"inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border",
						RATING_COLORS[fb.rating - 1] || "",
					)}>
						<span className="text-sm leading-none">{fb.rating}</span>
						<span className="hidden sm:inline text-[10px] opacity-70">{RATING_LABELS[fb.rating - 1]}</span>
					</span>
					<span className="font-semibold text-sm">{fb.user_name}</span>
				</div>
				<Badge variant={TAG_VARIANT[fb.tag] || "neutral"}>
					{TAG_LABEL[fb.tag] || fb.tag}
				</Badge>
			</div>
			{fb.content && (
				<div className="text-sm text-foreground mb-1 leading-relaxed">{fb.content}</div>
			)}
			<div className="text-xs text-muted-foreground/70 mb-1 flex items-center gap-2">
				{new Date(fb.created_at).toLocaleString("zh-CN")}
				{fb.version && <span className="opacity-50">v{fb.version}</span>}
			</div>
			{fb.developer_reply ? (
				<div className="mt-2 rounded-md border border-primary/20 bg-primary/5 p-2.5 text-sm leading-relaxed">
					<span className="text-xs font-medium text-primary">开发者回复：</span>
					{fb.developer_reply}
				</div>
			) : (
				!replyOpen && (
					<button
						type="button"
						onClick={() => setReplyOpen(true)}
						className="text-xs text-muted-foreground hover:text-primary underline mt-1"
					>
						添加回复
					</button>
				)
			)}
			{replyOpen && (
				<div className="mt-2 space-y-2">
					<textarea
						value={replyText}
						onChange={(e) => setReplyText(e.target.value)}
						placeholder="输入开发者回复..."
						rows={2}
						className="w-full p-2 rounded-md border border-border text-sm resize-none outline-none bg-card focus:border-primary"
					/>
					<div className="flex gap-2">
						<Button size="sm" onClick={handleReply} disabled={sending || !replyText.trim()}>
							{sending ? "发送中..." : "发送回复"}
						</Button>
						<Button size="sm" variant="ghost" onClick={() => setReplyOpen(false)}>取消</Button>
					</div>
				</div>
			)}
		</div>
	);
}
const PIE_LABELS = [
	"\u{1F61E} 很差",
	"\u{1F610} 较差",
	"\u{1F642} 一般",
	"\u{1F60A} 满意",
	"\u{1F60D} 很满意",
];

function FeedbackChart() {
	const [weekOffset, setWeekOffset] = useState(0);

	const weekLabel =
		weekOffset === 0
			? "本周"
			: weekOffset === -1
				? "上周"
				: `${-weekOffset}周前`;

	const now = new Date();
	const dayOfWeek = now.getDay();
	const monday = new Date(now);
	monday.setDate(
		now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + weekOffset * 7,
	);
	monday.setHours(0, 0, 0, 0);

	const pad = (n: number) => String(n).padStart(2, "0");
	const fmtDate = (d: Date) =>
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

	const days = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
	const dateKeys: string[] = [];
	for (let i = 0; i < 7; i++) {
		const d = new Date(monday);
		d.setDate(monday.getDate() + i);
		dateKeys.push(fmtDate(d));
	}

	const { data, isLoading } = useQuery({
		queryKey: queryKeys.admin.feedback.stats({ week: weekOffset }),
		queryFn: () =>
			getFeedbackStats({ date_from: dateKeys[0] }).then(({ data: stats }) => {
				const map: Record<string, FeedbackDailyItem> = {};
				(stats as FeedbackDailyItem[]).forEach((d) => {
					map[d.date] = d;
				});
				return dateKeys.map((dk, i) => {
					const s = map[dk];
					return {
						name: days[i],
						rating_1: s?.rating_1 || 0,
						rating_2: s?.rating_2 || 0,
						rating_3: s?.rating_3 || 0,
						rating_4: s?.rating_4 || 0,
						rating_5: s?.rating_5 || 0,
					};
				});
			}),
		initialData: [],
		staleTime: 2 * 60_000,
	});

	if (isLoading)
		return (
			<div className="h-[200px] flex items-center justify-center text-muted-foreground/70">
				加载图表...
			</div>
		);
	if (data.length === 0) return null;

	const colorMap: Record<string, string> = {
		rating_1: "#ef4444",
		rating_2: "#f97316",
		rating_3: "#eab308",
		rating_4: "#22c55e",
		rating_5: "#3b82f6",
	};
	const labelMap: Record<string, string> = {
		rating_1: "\u{1F61E} 很差",
		rating_2: "\u{1F610} 较差",
		rating_3: "\u{1F642} 一般",
		rating_4: "\u{1F60A} 满意",
		rating_5: "\u{1F60D} 很满意",
	};

	return (
		<div>
			<div className="flex items-center justify-between mb-2">
				<h3 className="text-sm font-normal flex items-center gap-1.5">
					<BarChart3 size={14} />
					{weekLabel}反馈分布
				</h3>
				<div className="flex gap-0.5">
					<button
						onClick={() => setWeekOffset((v) => v - 1)}
						className="flex items-center px-1.5 py-0.5 border border-border rounded-sm bg-card cursor-pointer"
					>
						<ChevronLeft size={12} />
					</button>
					<button
						onClick={() => setWeekOffset((v) => v + 1)}
						disabled={weekOffset >= 0}
						className={cn(
							"flex items-center px-1.5 py-0.5 border border-border rounded-sm bg-card",
							weekOffset >= 0 ? "cursor-default opacity-40" : "cursor-pointer",
						)}
					>
						<ChevronRight size={12} />
					</button>
				</div>
			</div>
			<ResponsiveContainer width="100%" height={160}>
				<BarChart data={data}>
					<CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
					<XAxis
						dataKey="name"
						tick={{ fontSize: 10 }}
						stroke="var(--muted-foreground)"
					/>
					<YAxis
						allowDecimals={false}
						tick={{ fontSize: 10 }}
						stroke="var(--muted-foreground)"
						width={24}
					/>
					<Tooltip
						content={<ChartTooltip />}
						formatter={(value, name) => [
							value,
							labelMap[name as string] || name,
						]}
					/>
					<Legend
						formatter={(value) => labelMap[value] || value}
						wrapperStyle={{ fontSize: 11 }}
					/>
					<Bar
						dataKey="rating_1"
						stackId="a"
						fill={colorMap.rating_1}
						name="rating_1"
					/>
					<Bar
						dataKey="rating_2"
						stackId="a"
						fill={colorMap.rating_2}
						name="rating_2"
					/>
					<Bar
						dataKey="rating_3"
						stackId="a"
						fill={colorMap.rating_3}
						name="rating_3"
					/>
					<Bar
						dataKey="rating_4"
						stackId="a"
						fill={colorMap.rating_4}
						name="rating_4"
					/>
					<Bar
						dataKey="rating_5"
						stackId="a"
						fill={colorMap.rating_5}
						name="rating_5"
					/>
				</BarChart>
			</ResponsiveContainer>
		</div>
	);
}

interface RatingPieChartProps {
	tag: string;
	dateFrom: string;
	dateTo: string;
}

function RatingPieChart({ tag, dateFrom, dateTo }: RatingPieChartProps) {
	const params: Record<string, unknown> = {};
	if (tag) params.tag = tag;
	if (dateFrom) params.date_from = dateFrom;
	if (dateTo) params.date_to = dateTo;

	const { data } = useQuery({
		queryKey: queryKeys.admin.feedback.stats({ tag, dateFrom, dateTo }),
		queryFn: () =>
			getFeedbackStats(params).then(({ data: stats }) => {
				const totals: Record<string, number> = {
					rating_1: 0,
					rating_2: 0,
					rating_3: 0,
					rating_4: 0,
					rating_5: 0,
				};
				(stats as FeedbackDailyItem[]).forEach((d) => {
					totals.rating_1 += d.rating_1 || 0;
					totals.rating_2 += d.rating_2 || 0;
					totals.rating_3 += d.rating_3 || 0;
					totals.rating_4 += d.rating_4 || 0;
					totals.rating_5 += d.rating_5 || 0;
				});
				return [
					{ name: "rating_1", value: totals.rating_1, idx: 0 },
					{ name: "rating_2", value: totals.rating_2, idx: 1 },
					{ name: "rating_3", value: totals.rating_3, idx: 2 },
					{ name: "rating_4", value: totals.rating_4, idx: 3 },
					{ name: "rating_5", value: totals.rating_5, idx: 4 },
				].filter((d) => d.value > 0);
			}),
		initialData: [],
		staleTime: 2 * 60_000,
	});

	const total = data.reduce((s, d) => s + d.value, 0);
	if (total === 0) return null;

	return (
		<div className="flex-[1_1_300px] min-w-[280px]">
			<h3 className="text-sm font-normal mb-2 flex items-center gap-1.5">
				<MessageSquare size={14} />
				评价分布
			</h3>
			<ResponsiveContainer width="100%" height={200}>
				<PieChart>
					<Pie
						data={data}
						dataKey="value"
						nameKey="name"
						cx="50%"
						cy="50%"
						outerRadius={70}
						innerRadius={35}
						label={({ name, percent }: { name?: string; percent?: number }) =>
							name
								? `${PIE_LABELS[Number(name.slice(-1)) - 1]?.slice(2)} ${((percent ?? 0) * 100).toFixed(0)}%`
								: ""
						}
						labelLine={false}
					>
						{data.map((d) => (
							<Cell key={d.name} fill={PIE_COLORS[d.idx]} />
						))}
					</Pie>
					<Tooltip
						content={<ChartTooltip />}
						formatter={(value, name) => {
							const n = String(name);
							return [
								String(value),
								PIE_LABELS[Number(n.slice(-1)) - 1] || n,
							] as [React.ReactNode, string];
						}}
					/>
				</PieChart>
			</ResponsiveContainer>
		</div>
	);
}

export default function FeedbackTab() {
	const [tag, setTag] = useState("");
	const [dateFrom, setDateFrom] = useState("");
	const [dateTo, setDateTo] = useState("");
	const [offset, setOffset] = useState(0);
	const LIMIT = 20;
	const _toast = useToast();

	const params: Record<string, unknown> = { offset, limit: LIMIT };
	if (tag) params.tag = tag;
	if (dateFrom) params.date_from = dateFrom;
	if (dateTo) params.date_to = dateTo;

	const { data: feedbacksData, isLoading, refetch } = useQuery({
		queryKey: queryKeys.admin.feedback.list(params),
		queryFn: () => getFeedbacks(params).then((r) => r.data),
		placeholderData: (prev) => prev,
		staleTime: 2 * 60_000,
	});

	const refetchFeedbacks = () => refetch();

	const feedbacks = feedbacksData?.items ?? [];
	const total = feedbacksData?.total ?? 0;

	const handleFilterChange = (key: "dateFrom" | "dateTo", value: string) => {
		if (key === "dateFrom") setDateFrom(value);
		else setDateTo(value);
		setOffset(0);
	};

	return (
		<div className="rounded-xl border border-border bg-card shadow-sm p-6">
			<div className="flex gap-6 mb-4 flex-wrap">
				<div className="flex-[1_1_300px] min-w-0">
					<FeedbackChart />
				</div>
				<RatingPieChart tag={tag} dateFrom={dateFrom} dateTo={dateTo} />
			</div>

			<div className="flex gap-2 flex-wrap items-center justify-between rounded-xl border border-border bg-muted shadow-sm p-3.5 mb-4">
				<div className="flex gap-2 items-end flex-wrap">
					<div>
						<label className="block text-xs text-muted-foreground mb-1">
							开始日期
						</label>
						<input
							type="date"
							value={dateFrom}
							onChange={(e) => handleFilterChange("dateFrom", e.target.value)}
							className="py-1.5 px-2.5 rounded-lg border border-border text-sm"
						/>
					</div>
					<span className="text-muted-foreground/70 text-sm self-end pb-1.5">
						—
					</span>
					<div>
						<label className="block text-xs text-muted-foreground mb-1">
							结束日期
						</label>
						<input
							type="date"
							value={dateTo}
							onChange={(e) => handleFilterChange("dateTo", e.target.value)}
							className="py-1.5 px-2.5 rounded-lg border border-border text-sm"
						/>
					</div>
					{(dateFrom || dateTo) && (
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								setDateFrom("");
								setDateTo("");
								setOffset(0);
							}}
						>
							清除
						</Button>
					)}
				</div>

				<div className="flex gap-2 flex-wrap">
					{TAG_OPTIONS.map((opt) => (
						<button
							key={opt.value}
							className={cn(
								"px-4 py-1.5 rounded-full border text-sm cursor-pointer transition-colors",
								tag === opt.value
									? "bg-primary text-primary-foreground border-primary"
									: "border-border bg-card text-muted-foreground hover:border-blue-400 hover:text-primary",
							)}
							onClick={() => setTag(opt.value)}
						>
							{opt.label}
						</button>
					))}
				</div>
			</div>

			<div className="mb-4 text-sm text-muted-foreground">
				共 {total} 条反馈
			</div>

			{isLoading ? (
				<LoadingState />
			) : feedbacks.length === 0 ? (
				<EmptyState icon={MessageSquare} title="暂无反馈" />
			) : (
				<div className="flex flex-col gap-2">
					{feedbacks.map((fb: FeedbackItem) => (
						<FeedbackRow key={fb.id} fb={fb} onReplied={refetchFeedbacks} />
					))}
				</div>
			)}
			<Pagination
				total={total}
				offset={offset}
				limit={LIMIT}
				onChange={setOffset}
			/>
		</div>
	);
}
