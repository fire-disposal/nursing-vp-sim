import { useQuery } from "@tanstack/react-query";
import {
	ActionIcon,
	Box,
	Center,
	Group,
	Paper,
	Select,
	Stack,
	Text,
	TextInput,
	UnstyledButton,
} from "@mantine/core";
import {
	IconCamera,
	IconChartBar,
	IconChevronDown,
	IconChevronLeft,
	IconChevronRight,
	IconChevronUp,
	IconMessageCircle,
} from "@tabler/icons-react";
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
import { useUiPrefsStore } from "@/stores/uiPrefsStore";
import { feedbackImageUrl, getFeedbackStats, getFeedbacks, replyFeedback } from "@/api";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import AuthImage from "@/components/ui/auth-image";
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import { ChartTooltip } from "@/components/ui/chart-tooltip";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import EmptyState from "@/components/ui/empty-state";
import LoadingState from "@/components/ui/loading-state";
import Pagination from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedSearch } from "@/hooks/useDebouncedSearch";

type Schemas = components["schemas"];
type FeedbackDailyItem = Schemas["FeedbackDailyItem"];
type FeedbackItem = Schemas["FeedbackItem"] & {
	developer_reply?: string | null;
	replied_at?: string | null;
	version?: string;
	auto_fix_attempted?: boolean;
	auto_fix_at?: string | null;
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
const RATING_BADGES: { variant: "danger" | "warning" | "success"; color?: string }[] = [
	{ variant: "danger" },
	{ variant: "warning", color: "orange" },
	{ variant: "warning" },
	{ variant: "success" },
	{ variant: "success", color: "teal" },
];

const PIE_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6"];

function FeedbackRow({ fb, onReplied }: { fb: FeedbackItem; onReplied: () => void }) {
	const [replyOpen, setReplyOpen] = useState(false);
	const [replyText, setReplyText] = useState("");
	const [sending, setSending] = useState(false);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
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
		<>
			<Paper withBorder radius="md" p="sm">
				<Group justify="space-between" mb={4}>
					<Group gap={8}>
						<Badge
							variant={RATING_BADGES[fb.rating - 1]?.variant ?? "neutral"}
							color={RATING_BADGES[fb.rating - 1]?.color}
						>
							{fb.rating} · {RATING_LABELS[fb.rating - 1]}
						</Badge>
						<Text size="sm" fw={600}>
							{fb.user_name}
						</Text>
					</Group>
					<Badge variant={TAG_VARIANT[fb.tag] || "neutral"}>
						{TAG_LABEL[fb.tag] || fb.tag}
					</Badge>
				</Group>
				{fb.content && (
					<Text size="sm" mb={4} lh={1.6}>
						{fb.content}
					</Text>
				)}
				{fb.image_ids && fb.image_ids.length > 0 && (
					<Group gap={6} mb={6} align="center" wrap="nowrap">
						<IconCamera size={13} style={{ flexShrink: 0 }} />
						<Group gap={6} wrap="nowrap">
							{fb.image_ids.map((imgId) => (
								<UnstyledButton
									key={imgId}
									onClick={() => setPreviewUrl(feedbackImageUrl(fb.id, imgId))}
									style={{
										flexShrink: 0,
										borderRadius: "var(--mantine-radius-md)",
										border: "1px solid var(--mantine-color-gray-3)",
										overflow: "hidden",
									}}
								>
									<AuthImage
										src={feedbackImageUrl(fb.id, imgId)}
										alt={`截图 ${imgId}`}
										className="h-16 w-auto object-cover"
									/>
								</UnstyledButton>
							))}
						</Group>
					</Group>
				)}
				<Group gap={8} mb={4}>
					<Text size="xs" c="dimmed">
						{new Date(fb.created_at).toLocaleString("zh-CN")}
					</Text>
					{fb.version && (
						<Text size="xs" c="dimmed" opacity={0.5}>
							v{fb.version}
						</Text>
					)}
					{fb.auto_fix_attempted && (
						<Badge
							variant="success"
							size="xs"
							title={fb.auto_fix_at ? `尝试时间: ${new Date(fb.auto_fix_at).toLocaleString("zh-CN")}` : ""}
						>
							已尝试自动修复
						</Badge>
					)}
				</Group>
				{fb.developer_reply ? (
					<Paper
						p="sm"
						mt={8}
						bg="var(--mantine-color-teal-0)"
						style={{ border: "1px solid var(--mantine-color-teal-3)" }}
					>
						<Text size="sm" lh={1.6}>
							<Text size="xs" fw={500} c="teal" component="span">
								开发者回复：
							</Text>
							{fb.developer_reply}
						</Text>
					</Paper>
				) : (
					!replyOpen && (
						<UnstyledButton onClick={() => setReplyOpen(true)} mt={4}>
							<Text size="xs" c="dimmed" td="underline">
								添加回复
							</Text>
						</UnstyledButton>
					)
				)}
				{replyOpen && (
					<Stack gap={8} mt={8}>
						<Textarea
							autosize
							minRows={2}
							value={replyText}
							onChange={(e) => setReplyText(e.currentTarget.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
									e.preventDefault();
									handleReply();
								}
							}}
							placeholder="输入开发者回复..."
						/>
						<Group gap={8}>
							<Button size="sm" onClick={handleReply} disabled={sending || !replyText.trim()}>
								{sending ? "发送中..." : "发送回复"}
							</Button>
							<Button size="sm" variant="ghost" onClick={() => setReplyOpen(false)}>取消</Button>
						</Group>
					</Stack>
				)}
			</Paper>
			{previewUrl && (
				<Dialog open onOpenChange={() => setPreviewUrl(null)}>
					<DialogContent title="截图预览" maxWidth={800}>
						<AuthImage src={previewUrl} alt="截图预览" className="max-w-full max-h-[70vh] object-contain rounded-md" />
					</DialogContent>
				</Dialog>
			)}
		</>
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
			<Center h={200}>
				<Text size="sm" c="dimmed">
					加载图表...
				</Text>
			</Center>
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
			<Group justify="space-between" mb={8}>
				<Group gap={6}>
					<IconChartBar size={14} />
					<Text size="sm">{weekLabel}反馈分布</Text>
				</Group>
				<Group gap={4}>
					<ActionIcon
						variant="default"
						size="sm"
						onClick={() => setWeekOffset((v) => v - 1)}
						aria-label="上一周"
					>
						<IconChevronLeft size={12} />
					</ActionIcon>
					<ActionIcon
						variant="default"
						size="sm"
						onClick={() => setWeekOffset((v) => v + 1)}
						disabled={weekOffset >= 0}
						aria-label="下一周"
					>
						<IconChevronRight size={12} />
					</ActionIcon>
				</Group>
			</Group>
			<ResponsiveContainer width="100%" height={160}>
				<BarChart data={data}>
					<CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-gray-3)" />
					<XAxis
						dataKey="name"
						tick={{ fontSize: 10 }}
						stroke="var(--mantine-color-dimmed)"
					/>
					<YAxis
						allowDecimals={false}
						tick={{ fontSize: 10 }}
						stroke="var(--mantine-color-dimmed)"
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
		<Box style={{ flex: "1 1 300px", minWidth: 280 }}>
			<Group gap={6} mb={8}>
				<IconMessageCircle size={14} />
				<Text size="sm">评价分布</Text>
			</Group>
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
		</Box>
	);
}


export default function FeedbackTab() {
	const [tag, setTag] = useState("");
	const [dateFrom, setDateFrom] = useState("");
	const [dateTo, setDateTo] = useState("");
	const [offset, setOffset] = useState(0);
	const { searchInput, debouncedValue: searchText, handleSearchChange } = useDebouncedSearch("", 300);
	const [replyStatus, setReplyStatus] = useState("");
	const chartsOpen = useUiPrefsStore((s) => s.feedbackChartsOpen);
	const setChartsOpen = useUiPrefsStore((s) => s.setFeedbackChartsOpen);
	const LIMIT = 20;

	// 服务端过滤：search / replied 与分页 total 同源，避免"过滤后空页"脱节
	const params: Record<string, unknown> = { offset, limit: LIMIT };
	if (tag) params.tag = tag;
	if (dateFrom) params.date_from = dateFrom;
	if (dateTo) params.date_to = dateTo;
	if (searchText) params.search = searchText;
	if (replyStatus === "replied") params.replied = true;
	else if (replyStatus === "unreplied") params.replied = false;

	const { data: feedbacksData, isLoading, refetch } = useQuery({
		queryKey: queryKeys.admin.feedback.list(params),
		queryFn: () => getFeedbacks(params).then((r) => r.data),
		placeholderData: (prev) => prev,
		staleTime: 2 * 60_000,
	});

	const refetchFeedbacks = () => refetch();

	const feedbacks = (feedbacksData?.items ?? []) as FeedbackItem[];
	const total = feedbacksData?.total ?? 0;

	const handleFilterChange = (key: "dateFrom" | "dateTo", value: string) => {
		if (key === "dateFrom") setDateFrom(value);
		else setDateTo(value);
		setOffset(0);
	};

	const toggleCharts = () => {
		setChartsOpen(!chartsOpen);
	};

	return (
		<Paper withBorder radius="lg" p="md" shadow="sm">
			<Box mb="md">
				<Button
					variant="ghost"
					size="sm"
					leftSection={<IconChartBar size={15} />}
					rightSection={chartsOpen ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
					onClick={toggleCharts}
					aria-expanded={chartsOpen}
				>
					统计概览
				</Button>
				{chartsOpen && (
					<Group gap="xl" align="flex-start" wrap="wrap" mt="sm">
						<Box style={{ flex: "1 1 300px", minWidth: 0 }}>
							<FeedbackChart />
						</Box>
						<RatingPieChart tag={tag} dateFrom={dateFrom} dateTo={dateTo} />
					</Group>
				)}
			</Box>

			<Paper withBorder radius="md" p="md" bg="var(--mantine-color-gray-1)" mb="md">
				<Group gap="lg" align="flex-end" wrap="wrap" justify="space-between">
					<Group gap={8} align="flex-end" wrap="wrap">
						<Stack gap={4}>
							<Text size="xs" c="dimmed">开始日期</Text>
							<TextInput
								type="date"
								size="sm"
								value={dateFrom}
								onChange={(e) => handleFilterChange("dateFrom", e.currentTarget.value)}
							/>
						</Stack>
						<Text size="sm" c="dimmed" mb={6}>-</Text>
						<Stack gap={4}>
							<Text size="xs" c="dimmed">结束日期</Text>
							<TextInput
								type="date"
								size="sm"
								value={dateTo}
								onChange={(e) => handleFilterChange("dateTo", e.currentTarget.value)}
							/>
						</Stack>
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
					</Group>

					<Group gap={8} wrap="wrap">
						<SearchInput
							value={searchInput}
							onChange={(v) => { handleSearchChange(v); setOffset(0); }}
							placeholder="搜索反馈内容..."
						/>
						<Select
							value={replyStatus || null}
							onChange={(v) => { setReplyStatus(v ?? ""); setOffset(0); }}
							data={[
								{ value: "", label: "全部回复" },
								{ value: "replied", label: "已回复" },
								{ value: "unreplied", label: "未回复" },
							]}
							size="sm"
							clearable
						/>
					</Group>

					<Group gap={8} wrap="wrap">
						{TAG_OPTIONS.map((opt) => (
							<Button
								key={opt.value}
								size="xs"
								radius="xl"
								variant={tag === opt.value ? "default" : "outline"}
								onClick={() => { setTag(opt.value); setOffset(0); }}
							>
								{opt.label}
							</Button>
						))}
					</Group>
				</Group>
			</Paper>

			<Text size="sm" c="dimmed" mb="md">
				共 {total} 条反馈
			</Text>

			{isLoading ? (
				<LoadingState />
			) : feedbacks.length === 0 ? (
				<EmptyState icon={IconMessageCircle} title="暂无反馈" />
			) : (
				<Stack gap={8}>
					{feedbacks.map((fb: FeedbackItem) => (
						<FeedbackRow key={fb.id} fb={fb} onReplied={refetchFeedbacks} />
					))}
				</Stack>
			)}
			<Pagination
				total={total}
				offset={offset}
				limit={LIMIT}
				onChange={setOffset}
			/>
		</Paper>
	);
}
