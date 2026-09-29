import { Badge, Box, Button, Group, Paper, Select, SimpleGrid, Stack, Text, ThemeIcon } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import {
	IconAward,
	IconBolt,
	IconChartLine,
	IconClock,
	IconMedal,
	IconSearch,
	IconTrendingUp,
	IconUsers,
} from "@tabler/icons-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { getAssignments } from "@/api/assignments";
import { getManageCases } from "@/api/cases";
import { getClasses } from "@/api/classes";
import { queryKeys } from "@/api/query-keys";
import { getScoreboardRanking } from "@/api/scoreboard";
import type { components } from "@/api/api-types.gen";
import StudentTrendDialog, {
	type TrendScope,
} from "@/components/admin/scoreboard/StudentTrendDialog";
import { formatDuration } from "@/utils/duration";
import { TextInput } from "@mantine/core";
import PageHeader from "@/components/ui/page-header";
import ResponsiveTable from "@/components/ui/responsive-table";
import { FilterToolbar } from "@/components/ui/filter-toolbar";
import StatCard from "@/components/ui/stat-card";
import type { GradePolicy } from "@/types/score";
import { bandLabel, capabilityNotice, numericBandSummary, toGradePolicy } from "@/utils/grade-bands";
import type { DataTableColumn } from "@/components/ui/data-table";

type ScoreboardRankingItem = components["schemas"]["ScoreboardRankingItem"];
type ScoreboardSummary = components["schemas"]["ScoreboardSummary"];

const LIMIT = 50;

const SORT_OPTIONS: { value: string; label: string }[] = [
	{ value: "avg_score", label: "平均分" },
	{ value: "best_score", label: "最高分" },
	{ value: "avg_duration", label: "平均用时" },
	{ value: "training_count", label: "训练次数" },
	{ value: "progress", label: "进步幅度" },
];

const TIER_COLORS: Record<string, "green" | "yellow" | "red"> = {
	good: "green",
	medium: "yellow",
	poor: "red",
};

/**
 * 数值分段 → 展示标签。标签与阈值**都来自服务端等第政策**（`policy.numeric_bands`）；
 * 服务端没给标签时退回 band id 的固定中文对照（含「数值参考」前缀，不含数字）。
 * 页面不出现「好中差」这类像能力结论的措辞，也不在客户端算阈值。
 */
function tierCell(tier: string, policy: GradePolicy | null) {
	const label = bandLabel(tier, policy);
	if (!label) return <Text size="xs" c="dimmed">—</Text>;
	return (
		<Badge variant="light" color={TIER_COLORS[tier] ?? "gray"}>
			{label}
		</Badge>
	);
}


function rankBadge(rank: number) {
	if (rank === 1)
		return <ThemeIcon size={24} radius="md" variant="light" color="yellow" fw={700}>1</ThemeIcon>;
	if (rank === 2)
		return <ThemeIcon size={24} radius="md" variant="light" color="gray" fw={700}>2</ThemeIcon>;
	if (rank === 3)
		return <ThemeIcon size={24} radius="md" variant="light" color="orange" fw={700}>3</ThemeIcon>;
	return <Text size="sm" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>{rank}</Text>;
}

function progressCell(item: ScoreboardRankingItem) {
	if (item.progress_delta == null) {
		return <Text size="xs" c="dimmed">—</Text>;
	}
	const delta = item.progress_delta;
	const up = item.progress_trend === "up";
	const down = item.progress_trend === "down";
	const color = up ? "green" : down ? "red" : "dimmed";
	return (
		<Text component="span" size="xs" fw={500} c={color} style={{ fontVariantNumeric: "tabular-nums" }}>
			{up ? "▲" : down ? "▼" : "•"} {delta >= 0 ? "+" : ""}
			{delta.toFixed(1)}
		</Text>
	);
}

function avgScoreCell(item: ScoreboardRankingItem) {
	const color = item.tier ? TIER_COLORS[item.tier] : undefined;
	return (
		<Text component="span" fw={600} c={color} style={{ fontVariantNumeric: "tabular-nums" }}>
			{item.avg_score ?? "-"}
		</Text>
	);
}

function TierDistribution({
	summary,
	policy,
}: {
	summary: ScoreboardSummary | undefined;
	policy: GradePolicy | null;
}) {
	const counts = summary?.tier_counts ?? {};
	// 分段名称与阈值只认服务端政策：没有 policy 就不画（不自己起名、不自己算阈值）
	const bands = policy?.numeric_bands ?? [];
	const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
	if (!policy || bands.length === 0 || total === 0) return null;

	const segments = bands.map((band) => ({
		key: band.band,
		label: band.label,
		count: counts[band.band] ?? 0,
	}));
	// 服务端只列出有下限的分段（如 good/medium），其余记录归入最低一段：按阈值描述，不起名
	const listed = segments.reduce((sum, segment) => sum + segment.count, 0);
	const restCount = Math.max(0, total - listed);
	const restLabel = `低于 ${bands[bands.length - 1].min} 分`;
	const colors = ["var(--mantine-color-green-6)", "var(--mantine-color-yellow-6)", "var(--mantine-color-red-6)"];
	const notice = capabilityNotice(policy);

	return (
		<Paper withBorder p="lg">
			<Box>
				<Group justify="space-between" align="center" wrap="wrap" gap={8} mb={8}>
					<Text size="sm" fw={500}>数值分段分布</Text>
					<Group gap={12} wrap="wrap">
						{segments.map((segment, index) => (
							<Group key={segment.key} gap={4} align="center" wrap="nowrap">
								<Box
									bg={colors[index % colors.length]}
									style={{ width: 8, height: 8, borderRadius: "50%" }}
								/>
								<Text size="xs" c="dimmed">
									{segment.label} {segment.count}
								</Text>
							</Group>
						))}
						<Group gap={4} align="center" wrap="nowrap">
							<Box bg="var(--mantine-color-gray-5)" style={{ width: 8, height: 8, borderRadius: "50%" }} />
							<Text size="xs" c="dimmed">
								{restLabel} {restCount}
							</Text>
						</Group>
					</Group>
				</Group>
				<Box
					style={{
						display: "flex",
						height: 12,
						width: "100%",
						overflow: "hidden",
						borderRadius: 999,
						background: "var(--mantine-color-default-hover)",
					}}
				>
					{segments.map((segment, index) => (
						<Box
							key={segment.key}
							style={{
								height: "100%",
								width: `${(segment.count / total) * 100}%`,
								background: colors[index % colors.length],
							}}
						/>
					))}
					<Box style={{ height: "100%", flex: 1, background: "var(--mantine-color-gray-5)" }} />
				</Box>
				<Text size="xs" c="dimmed" mt={8}>
					{numericBandSummary(policy) ?? "数值分段阈值由服务端等第政策给出。"}
					{policy.numeric_band_description ? `（${policy.numeric_band_description}）` : ""}
				</Text>
				{notice && (
					<Text size="xs" c="dimmed" mt={4}>
						{notice.label}
						{notice.note ? `：${notice.note}` : ""}
					</Text>
				)}
			</Box>
		</Paper>
	);
}

interface FilterSelectProps {
	label: string;
	value: string;
	onChange: (v: string) => void;
	data: { value: string; label: string }[];
	/** 长列表（病例/班级/作业）开启键入过滤 */
	searchable?: boolean;
	width?: number;
}

function FilterSelect({ label, value, onChange, data, searchable, width }: FilterSelectProps) {
	return (
		<Group gap={8} align="center" wrap="nowrap">
			<Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{label}</Text>
			<Select
				value={value || "all"}
				onChange={(v) => onChange(v === "all" ? "" : (v ?? ""))}
				data={data}
				w={width ?? 130}
				size="xs"
				// 病例/班级/作业都是会长的列表：允许键入过滤，否则下拉里翻几十上百项不可用
				searchable={searchable}
				nothingFoundMessage="无匹配项"
			/>
		</Group>
	);
}

export default function ScoreboardPage() {
	const [searchParams, setSearchParams] = useSearchParams();

	const caseId = searchParams.get("case_id") || "";
	const classId = searchParams.get("class_id") || "";
	const assignmentStatus = searchParams.get("assignment_status") || "";
	const includeFree = searchParams.get("include_free") === "1";
	const sortBy = searchParams.get("sort_by") || "avg_score";
	const tier = searchParams.get("tier") || "";
	const search = searchParams.get("search") || "";

	const [searchInput, setSearchInput] = useState(search);
	const [offset, setOffset] = useState(0);
	const [trendUserId, setTrendUserId] = useState<number | null>(null);

	const updateParam = useCallback(
		(key: string, value: string) => {
			setSearchParams((prev) => {
				const next = new URLSearchParams(prev);
				if (value) next.set(key, value);
				else next.delete(key);
				return next;
			});
			setOffset(0);
		},
		[setSearchParams],
	);

	const assignmentId = searchParams.get("assignment_id") || "";

	const scope = useMemo<TrendScope>(
		() => ({
			case_id: caseId ? Number(caseId) : null,
			class_id: classId ? Number(classId) : null,
			assignment_id: assignmentId || null,
			assignment_status: assignmentStatus || null,
			include_free: includeFree,
		}),
		[caseId, classId, assignmentId, assignmentStatus, includeFree],
	);

	const { data, isLoading } = useQuery({
		queryKey: queryKeys.scoreboard.ranking({
			case_id: scope.case_id,
			class_id: scope.class_id,
			assignment_id: scope.assignment_id,
			assignment_status: scope.assignment_status,
			include_free: scope.include_free,
			search: search || null,
			sort_by: sortBy,
			tier: tier || null,
			offset,
			limit: LIMIT,
		}),
		queryFn: () =>
			getScoreboardRanking({
				case_id: scope.case_id,
				class_id: scope.class_id,
				assignment_id: scope.assignment_id,
				assignment_status: scope.assignment_status,
				include_free: scope.include_free,
				search: search || null,
				sort_by: sortBy,
				tier: tier || null,
				offset,
				limit: LIMIT,
			}).then((r) => r.data),
		staleTime: 30_000,
	});

	const { data: casesData } = useQuery({
		queryKey: queryKeys.cases.managed.all,
		queryFn: () => getManageCases({ limit: 100 }).then((r) => r.data),
		staleTime: 5 * 60_000,
	});
	const { data: classesData } = useQuery({
		queryKey: queryKeys.classes.list(null),
		queryFn: () => getClasses({}).then((r) => r.data),
		staleTime: 5 * 60_000,
	});
	const { data: assignmentsData } = useQuery({
		queryKey: queryKeys.assignments.list({ class_id: classId || null }),
		queryFn: () =>
			getAssignments({ limit: 200, ...(classId ? { class_id: Number(classId) } : {}) }).then(
				(r) => r.data,
			),
		staleTime: 2 * 60_000,
	});

	const cases = (casesData?.items ?? []) as { id: number; name: string }[];
	const classes = classesData ?? [];
	const assignments = (assignmentsData?.items ?? []) as {
		id: string;
		title: string;
		case_name?: string | null;
	}[];

	const items = (data?.items ?? []) as ScoreboardRankingItem[];
	const summary = data?.summary as ScoreboardSummary | undefined;
	const total = data?.total ?? 0;
	// 数值分段的标签与阈值由服务端等第政策给出（响应里 policy 与 summary.policy 同一份）
	const policy = useMemo(
		() => toGradePolicy(data?.policy ?? summary?.policy),
		[data?.policy, summary?.policy],
	);
	// 分段筛选项的 value/label 都来自服务端 policy；没有政策就不渲染该筛选（不自己造分段名）
	const tierFilterOptions = useMemo(
		() => [
			{ value: "all", label: "全部数值分段" },
			...(policy?.numeric_bands ?? []).map((band) => ({ value: band.band, label: band.label })),
		],
		[policy],
	);

	/** 一键复位：把筛选相关参数整体从 URL 上摘掉（与其它列表页同语义）。 */
	const handleClearFilters = useCallback(() => {
		const next = new URLSearchParams(searchParams);
		for (const key of [
			"case_id",
			"class_id",
			"assignment_id",
			"assignment_status",
			"include_free",
			"tier",
			"search",
			"sort_by",
			"offset",
		]) {
			next.delete(key);
		}
		setSearchParams(next, { replace: true });
		setSearchInput("");
	}, [searchParams, setSearchParams]);

	const applySearch = () => {
		updateParam("search", searchInput.trim());
	};

	const rightText = (node: ReactNode) => (
		<Text ta="right" size="sm" style={{ fontVariantNumeric: "tabular-nums" }}>{node}</Text>
	);

	const columns: DataTableColumn<ScoreboardRankingItem>[] = [
		{
			key: "rank",
			header: "排名",
			render: (r) => rankBadge(r.rank),
		},
		{
			key: "student",
			header: "学生",
			render: (r) => (
				<div>
					<Text fw={500}>{r.display_name}</Text>
					{r.student_id && (
						<Text size="xs" c="dimmed">{r.student_id}</Text>
					)}
				</div>
			),
		},
		{
			key: "class_name",
			header: "班级",
			render: (r) => <Text size="sm" c="dimmed">{r.class_name}</Text>,
		},
		{
			key: "avg_score",
			header: "平均分",
			render: (r) => rightText(avgScoreCell(r)),
		},
		{
			key: "best_score",
			header: "最高分",
			render: (r) => rightText(r.best_score ?? "-"),
		},
		{
			key: "avg_duration",
			header: "平均用时",
			render: (r) => rightText(formatDuration(r.avg_duration_seconds)),
		},
		{
			key: "training_count",
			header: "次数",
			render: (r) => rightText(r.training_count),
		},
		{
			key: "case_count",
			header: "病例数",
			render: (r) => rightText(r.case_count),
		},
		{ key: "tier", header: "数值分段", render: (r) => tierCell(r.tier, policy) },
		{
			key: "progress",
			header: "进步幅度",
			render: (r) => rightText(progressCell(r)),
		},
		{
			key: "actions",
			header: "操作",
			render: (r) => (
				<Button
					variant="subtle" color="gray"
					w={44} h={44} p={0}
					title="查看趋势"
					onClick={() => setTrendUserId(r.user_id)}
				>
					<IconChartLine size={16} />
				</Button>
			),
		},
	];

	return (
		<Stack gap="md">
			<PageHeader
				title="成绩管理"
				subtitle="学生平均成绩排名 · 数值分段（非能力等第）· 进步幅度"
				icon={IconAward}
			/>

			<FilterToolbar
				compact
				hasActiveFilters={Boolean(
					caseId || classId || assignmentId || assignmentStatus || includeFree || tier || search || sortBy !== "avg_score",
				)}
				onClear={handleClearFilters}
				search={
					<Group gap={8} align="center" wrap="nowrap">
						<TextInput
							value={searchInput}
							onChange={(e) => setSearchInput(e.currentTarget.value)}
							onKeyDown={(e) => e.key === "Enter" && applySearch()}
							placeholder="姓名/学号检索"
							leftSection={<IconSearch size={14} />}
							size="sm"
							w={180}
						/>
						<Button variant="subtle" color="gray" size="sm" onClick={applySearch}>
							检索
						</Button>
					</Group>
				}
				filters={
					<>
						<FilterSelect
							label="病例范围"
							searchable
							width={180}
							value={caseId}
							onChange={(v) => updateParam("case_id", v)}
							data={[
								{ value: "all", label: "全部病例" },
								...cases.map((c) => ({ value: String(c.id), label: c.name })),
							]}
						/>
						<FilterSelect
							label="班级"
							searchable
							width={160}
							value={classId}
							onChange={(v) => updateParam("class_id", v)}
							data={[
								{ value: "all", label: "全部班级" },
								...classes.map((c) => ({
									value: String(c.id),
									label: c.cohort_label ? `${c.cohort_label} ${c.name}` : c.name,
								})),
							]}
						/>
						<FilterSelect
							label="作业"
							searchable
							width={230}
							value={assignmentId}
							onChange={(v) => updateParam("assignment_id", v)}
							data={[
								{ value: "all", label: "全部作业" },
								// 同名作业跨病例很常见：带上病例名，方便检索与辨认
								...assignments.map((a) => ({
									value: a.id,
									label: a.case_name ? `${a.title} · ${a.case_name}` : a.title,
								})),
							]}
						/>
						<FilterSelect
							label="作业状态"
							value={assignmentStatus}
							onChange={(v) => updateParam("assignment_status", v)}
							data={[
								{ value: "all", label: "全部状态" },
								{ value: "active", label: "进行中" },
								{ value: "ended", label: "已结束" },
							]}
						/>
						<FilterSelect
							label="统计范围"
							value={includeFree ? "1" : ""}
							onChange={(v) => updateParam("include_free", v)}
							data={[
								{ value: "all", label: "仅作业" },
								{ value: "1", label: "含自主训练" },
							]}
						/>
						<FilterSelect
							label="排序"
							value={sortBy}
							onChange={(v) => updateParam("sort_by", v)}
							data={SORT_OPTIONS}
						/>
						{policy && (
							<FilterSelect
								label="数值分段"
								value={tier}
								onChange={(v) => updateParam("tier", v)}
								data={tierFilterOptions}
							/>
						)}
					</>
				}
			/>

			<SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
				<StatCard icon={IconBolt} value={summary?.record_count ?? "-"} label="计入训练次数" color="blue" />
				<StatCard icon={IconUsers} value={summary?.student_count ?? "-"} label="入榜学生" color="blue" />
				<StatCard
					icon={IconMedal}
					value={summary?.avg_score ?? "-"}
					label="学生平均分"
					color="green"
				/>
				<StatCard
					icon={IconClock}
					value={formatDuration(summary?.avg_duration_seconds)}
					label="平均用时"
					color="amber"
				/>
			</SimpleGrid>

			<TierDistribution summary={summary} policy={policy} />

			{/* 与其它列表页同形：Paper + 表格自身当唯一描边层（原先 Card + CardContent 多一层） */}
			<Paper withBorder style={{ overflow: "hidden" }}>
				<ResponsiveTable
						columns={columns}
						rows={items}
						rowKey={(r) => r.user_id}
						loading={isLoading}
						bare
						total={total}
						offset={offset}
						limit={LIMIT}
						onOffsetChange={setOffset}
						emptyIcon={IconTrendingUp}
						emptyTitle="暂无成绩数据"
						emptyDescription="调整筛选范围，或等待学生完成训练并评分后重试"
						renderCard={(r) => (
							<Group
								justify="space-between"
								align="center"
								gap={12}
								wrap="nowrap"
								style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 12, padding: 12 }}
							>
								<Group gap={12} align="center" wrap="nowrap" style={{ minWidth: 0 }}>
									{rankBadge(r.rank)}
									<div style={{ minWidth: 0 }}>
										<Text fw={500} truncate>{r.display_name}</Text>
										<Text size="xs" c="dimmed">
											{r.class_name || "—"} · {r.training_count} 次 · {formatDuration(r.avg_duration_seconds)}
										</Text>
									</div>
								</Group>
								<Group gap={8} align="center" wrap="nowrap" style={{ flexShrink: 0 }}>
									{avgScoreCell(r)}
									{tierCell(r.tier, policy)}
									<Button
										variant="subtle" color="gray"
										w={44} h={44} p={0}
										title="查看趋势"
										onClick={() => setTrendUserId(r.user_id)}
									>
										<IconChartLine size={16} />
									</Button>
								</Group>
							</Group>
						)}
					/>
			</Paper>

			<StudentTrendDialog
				open={trendUserId != null}
				userId={trendUserId}
				scope={scope}
				onOpenChange={(o) => {
					if (!o) setTrendUserId(null);
				}}
			/>
		</Stack>
	);
}
