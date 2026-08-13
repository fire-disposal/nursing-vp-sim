import { Badge, Box, Button, Group, Select, SimpleGrid, Stack, Text, ThemeIcon } from "@mantine/core";
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
	IconX,
} from "@tabler/icons-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { getAssignments } from "@/api/assignments";
import { getManageCases } from "@/api/cases";
import { getClasses } from "@/api/grades-classes";
import { queryKeys } from "@/api/query-keys";
import { getScoreboardRanking } from "@/api/scoreboard";
import type { components } from "@/api/api-types.gen";
import StudentTrendDialog, {
	formatDuration,
	type TrendScope,
} from "@/components/admin/scoreboard/StudentTrendDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import PageHeader from "@/components/ui/page-header";
import ResponsiveTable from "@/components/ui/responsive-table";
import StatCard from "@/components/ui/stat-card";
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

const TIER_OPTIONS: { value: string; label: string }[] = [
	{ value: "all", label: "全部层次" },
	{ value: "good", label: "好" },
	{ value: "medium", label: "中" },
	{ value: "poor", label: "差" },
];

const TIER_BADGE: Record<string, { label: string; color: "green" | "yellow" | "red" }> = {
	good: { label: "好", color: "green" },
	medium: { label: "中", color: "yellow" },
	poor: { label: "差", color: "red" },
};

function rankBadge(rank: number) {
	if (rank === 1)
		return <ThemeIcon size={24} radius="md" variant="light" color="yellow" fw={700}>1</ThemeIcon>;
	if (rank === 2)
		return <ThemeIcon size={24} radius="md" variant="light" color="gray" fw={700}>2</ThemeIcon>;
	if (rank === 3)
		return <ThemeIcon size={24} radius="md" variant="light" color="orange" fw={700}>3</ThemeIcon>;
	return <Text size="sm" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>{rank}</Text>;
}

function tierCell(tier: string) {
	const def = TIER_BADGE[tier];
	if (!def) return <Text size="xs" c="dimmed">—</Text>;
	return <Badge variant="light" color={def.color}>{def.label}</Badge>;
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
	const tier = item.tier;
	const color =
		tier === "good"
			? "green"
			: tier === "medium"
				? "yellow"
				: tier === "poor"
					? "red"
					: undefined;
	return (
		<Text component="span" fw={600} c={color} style={{ fontVariantNumeric: "tabular-nums" }}>
			{item.avg_score ?? "-"}
		</Text>
	);
}

function TierDistribution({ summary }: { summary: ScoreboardSummary | undefined }) {
	const counts = summary?.tier_counts ?? {};
	const total = (counts.good ?? 0) + (counts.medium ?? 0) + (counts.poor ?? 0);
	if (!total) return null;
	const good = ((counts.good ?? 0) / total) * 100;
	const medium = ((counts.medium ?? 0) / total) * 100;

	return (
		<Card>
			<CardContent>
				<Group justify="space-between" align="center" wrap="wrap" gap={8} mb={8}>
					<Text size="sm" fw={500}>好中差分层</Text>
					<Group gap={12} wrap="wrap">
						<Group gap={4} align="center" wrap="nowrap">
							<Box bg="green.6" style={{ width: 8, height: 8, borderRadius: "50%" }} />
							<Text size="xs" c="dimmed">好 {counts.good ?? 0}</Text>
						</Group>
						<Group gap={4} align="center" wrap="nowrap">
							<Box bg="yellow.6" style={{ width: 8, height: 8, borderRadius: "50%" }} />
							<Text size="xs" c="dimmed">中 {counts.medium ?? 0}</Text>
						</Group>
						<Group gap={4} align="center" wrap="nowrap">
							<Box bg="red.6" style={{ width: 8, height: 8, borderRadius: "50%" }} />
							<Text size="xs" c="dimmed">差 {counts.poor ?? 0}</Text>
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
						background: "var(--mantine-color-gray-2)",
					}}
				>
					<Box style={{ height: "100%", width: `${good}%`, background: "var(--mantine-color-green-6)" }} />
					<Box style={{ height: "100%", width: `${medium}%`, background: "var(--mantine-color-yellow-6)" }} />
					<Box style={{ height: "100%", flex: 1, background: "var(--mantine-color-red-6)" }} />
				</Box>
				<Text size="xs" c="dimmed" mt={8}>
					分层阈值：平均分 ≥ 85 为好，60 ≤ 平均分 &lt; 85 为中，平均分 &lt; 60 为差
				</Text>
			</CardContent>
		</Card>
	);
}

interface FilterSelectProps {
	label: string;
	value: string;
	onChange: (v: string) => void;
	data: { value: string; label: string }[];
}

function FilterSelect({ label, value, onChange, data }: FilterSelectProps) {
	return (
		<Group gap={8} align="center" wrap="nowrap">
			<Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{label}</Text>
			<Select
				value={value || "all"}
				onChange={(v) => onChange(v === "all" ? "" : (v ?? ""))}
				data={data}
				w={130}
				size="xs"
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
		queryKey: queryKeys.grades.classes(),
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
	const classes = (classesData ?? []) as { id: number; name: string }[];
	const assignments = (assignmentsData?.items ?? []) as {
		id: string;
		title: string;
	}[];

	const items = (data?.items ?? []) as ScoreboardRankingItem[];
	const summary = data?.summary as ScoreboardSummary | undefined;
	const total = data?.total ?? 0;

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
		{ key: "tier", header: "层次", render: (r) => tierCell(r.tier) },
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
				subtitle="学生平均成绩排名 · 好中差分档 · 进步幅度"
				icon={IconAward}
			/>

			<Card>
				<CardContent>
					<Group gap={16} wrap="wrap">
						<FilterSelect
							label="病例范围"
							value={caseId}
							onChange={(v) => updateParam("case_id", v)}
							data={[
								{ value: "all", label: "全部病例" },
								...cases.map((c) => ({ value: String(c.id), label: c.name })),
							]}
						/>
						<FilterSelect
							label="班级"
							value={classId}
							onChange={(v) => updateParam("class_id", v)}
							data={[
								{ value: "all", label: "全部班级" },
								...classes.map((c) => ({ value: String(c.id), label: c.name })),
							]}
						/>
						<FilterSelect
							label="作业"
							value={assignmentId}
							onChange={(v) => updateParam("assignment_id", v)}
							data={[
								{ value: "all", label: "全部作业" },
								...assignments.map((a) => ({ value: a.id, label: a.title })),
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
						<FilterSelect
							label="层次"
							value={tier}
							onChange={(v) => updateParam("tier", v)}
							data={TIER_OPTIONS}
						/>
						<Group gap={8} align="center" wrap="nowrap">
							<Input
								value={searchInput}
								onChange={(e) => setSearchInput(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && applySearch()}
								placeholder="姓名/学号检索"
								leftSection={<IconSearch size={14} />}
								size="xs"
								w={160}
							/>
							<Button variant="subtle" color="gray" size="sm" onClick={applySearch}>
								检索
							</Button>
							{search && (
								<Button
									variant="subtle" color="gray"
									w={44} h={44} p={0}
									title="清除检索"
									onClick={() => {
										setSearchInput("");
										updateParam("search", "");
									}}
								>
									<IconX size={14} />
								</Button>
							)}
						</Group>
					</Group>
				</CardContent>
			</Card>

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

			<TierDistribution summary={summary} />

			<Card>
				<CardContent style={{ padding: 0 }}>
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
									{tierCell(r.tier)}
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
				</CardContent>
			</Card>

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
