import { useQuery } from "@tanstack/react-query";
import {
	Award,
	ChartLine,
	Clock,
	Medal,
	Search,
	TrendingUp,
	Users,
	X,
	Zap,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
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
import Badge from "@/components/ui/badge";
import Button from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import PageHeader from "@/components/ui/page-header";
import ResponsiveTable from "@/components/ui/responsive-table";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import StatCard from "@/components/ui/stat-card";
import type { DataTableColumn } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";

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

const TIER_BADGE: Record<string, { label: string; variant: "success" | "warning" | "danger" }> = {
	good: { label: "好", variant: "success" },
	medium: { label: "中", variant: "warning" },
	poor: { label: "差", variant: "danger" },
};

function rankBadge(rank: number) {
	if (rank === 1)
		return (
			<span className="inline-flex size-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
				1
			</span>
		);
	if (rank === 2)
		return (
			<span className="inline-flex size-6 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600 dark:bg-slate-500/25 dark:text-slate-300">
				2
			</span>
		);
	if (rank === 3)
		return (
			<span className="inline-flex size-6 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-700 dark:bg-orange-500/20 dark:text-orange-400">
				3
			</span>
		);
	return <span className="text-sm tabular-nums text-muted-foreground">{rank}</span>;
}

function tierCell(tier: string) {
	const def = TIER_BADGE[tier];
	if (!def) return <span className="text-xs text-muted-foreground">—</span>;
	return <Badge variant={def.variant}>{def.label}</Badge>;
}

function progressCell(item: ScoreboardRankingItem) {
	if (item.progress_delta == null) {
		return <span className="text-xs text-muted-foreground">—</span>;
	}
	const delta = item.progress_delta;
	const up = item.progress_trend === "up";
	const down = item.progress_trend === "down";
	return (
		<span
			className={cn(
				"text-xs font-medium tabular-nums",
				up
					? "text-success-foreground"
					: down
						? "text-destructive"
						: "text-muted-foreground",
			)}
		>
			{up ? "▲" : down ? "▼" : "•"} {delta >= 0 ? "+" : ""}
			{delta.toFixed(1)}
		</span>
	);
}

function avgScoreCell(item: ScoreboardRankingItem) {
	const tier = item.tier;
	return (
		<span
			className={cn(
				"font-semibold tabular-nums",
				tier === "good"
					? "text-success-foreground"
					: tier === "medium"
						? "text-warning-foreground"
						: tier === "poor"
							? "text-destructive"
							: "text-foreground",
			)}
		>
			{item.avg_score ?? "-"}
		</span>
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
			<CardContent className="p-4">
				<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
					<p className="text-sm font-medium text-foreground">好中差分层</p>
					<div className="flex items-center gap-3 text-xs text-muted-foreground">
						<span className="inline-flex items-center gap-1">
							<span className="size-2 rounded-full bg-success" /> 好 {counts.good ?? 0}
						</span>
						<span className="inline-flex items-center gap-1">
							<span className="size-2 rounded-full bg-warning" /> 中 {counts.medium ?? 0}
						</span>
						<span className="inline-flex items-center gap-1">
							<span className="size-2 rounded-full bg-danger" /> 差 {counts.poor ?? 0}
						</span>
					</div>
				</div>
				<div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
					<div
						className="h-full bg-success transition-all"
						style={{ width: `${good}%` }}
					/>
					<div
						className="h-full bg-warning transition-all"
						style={{ width: `${medium}%` }}
					/>
					<div className="h-full flex-1 bg-danger transition-all" />
				</div>
				<p className="mt-2 text-xs text-muted-foreground">
					分层阈值：平均分 ≥ 85 为好，60 ≤ 平均分 &lt; 85 为中，平均分 &lt; 60 为差
				</p>
			</CardContent>
		</Card>
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

	const columns: DataTableColumn<ScoreboardRankingItem>[] = [
		{
			key: "rank",
			header: "排名",
			cellClassName: "w-14",
			render: (r) => rankBadge(r.rank),
		},
		{
			key: "student",
			header: "学生",
			cellClassName: "min-w-[120px]",
			render: (r) => (
				<div>
					<p className="font-medium text-foreground">{r.display_name}</p>
					{r.student_id && (
						<p className="text-xs text-muted-foreground">{r.student_id}</p>
					)}
				</div>
			),
		},
		{ key: "class_name", header: "班级", cellClassName: "text-sm text-muted-foreground" },
		{
			key: "avg_score",
			header: "平均分",
			cellClassName: "text-right",
			render: (r) => avgScoreCell(r),
		},
		{
			key: "best_score",
			header: "最高分",
			cellClassName: "text-right tabular-nums text-sm",
			render: (r) => r.best_score ?? "-",
		},
		{
			key: "avg_duration",
			header: "平均用时",
			cellClassName: "text-right tabular-nums text-sm",
			render: (r) => formatDuration(r.avg_duration_seconds),
		},
		{
			key: "training_count",
			header: "次数",
			cellClassName: "text-right tabular-nums text-sm",
			render: (r) => r.training_count,
		},
		{
			key: "case_count",
			header: "病例数",
			cellClassName: "text-right tabular-nums text-sm",
			render: (r) => r.case_count,
		},
		{ key: "tier", header: "层次", cellClassName: "w-16", render: (r) => tierCell(r.tier) },
		{
			key: "progress",
			header: "进步幅度",
			cellClassName: "text-right",
			render: (r) => progressCell(r),
		},
		{
			key: "actions",
			header: "操作",
			cellClassName: "w-16",
			render: (r) => (
				<Button
					variant="ghost"
					size="icon"
					title="查看趋势"
					onClick={() => setTrendUserId(r.user_id)}
				>
					<ChartLine size={16} />
				</Button>
			),
		},
	];

	const filterSelect = (
		label: string,
		value: string,
		onValueChange: (v: string) => void,
		children: React.ReactNode,
	) => (
		<label className="flex items-center gap-2">
			<span className="shrink-0 text-xs text-muted-foreground">{label}</span>
			<Select value={value || "all"} onValueChange={(v) => onValueChange(v === "all" ? "" : (v ?? ""))}>
				<SelectTrigger size="sm" className="w-[130px] text-sm">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>{children}</SelectContent>
			</Select>
		</label>
	);

	return (
		<div className="space-y-4">
			<PageHeader
				title="成绩管理"
				subtitle="学生平均成绩排名 · 好中差分档 · 进步幅度"
				icon={Award}
			/>

			<Card>
				<CardContent className="p-3 sm:p-4">
					<div className="flex flex-wrap items-center gap-x-4 gap-y-3">
						{filterSelect(
							"病例范围",
							caseId,
							(v) => updateParam("case_id", v),
							<>
								<SelectItem value="all">全部病例</SelectItem>
								{cases.map((c) => (
									<SelectItem key={c.id} value={String(c.id)}>
										{c.name}
									</SelectItem>
								))}
							</>,
						)}
						{filterSelect(
							"班级",
							classId,
							(v) => updateParam("class_id", v),
							<>
								<SelectItem value="all">全部班级</SelectItem>
								{classes.map((c) => (
									<SelectItem key={c.id} value={String(c.id)}>
										{c.name}
									</SelectItem>
								))}
							</>,
						)}
						{filterSelect(
							"作业",
							assignmentId,
							(v) => updateParam("assignment_id", v),
							<>
								<SelectItem value="all">全部作业</SelectItem>
								{assignments.map((a) => (
									<SelectItem key={a.id} value={a.id}>
										{a.title}
									</SelectItem>
								))}
							</>,
						)}
						{filterSelect(
							"作业状态",
							assignmentStatus,
							(v) => updateParam("assignment_status", v),
							<>
								<SelectItem value="all">全部状态</SelectItem>
								<SelectItem value="active">进行中</SelectItem>
								<SelectItem value="ended">已结束</SelectItem>
							</>,
						)}
						{filterSelect(
							"统计范围",
							includeFree ? "1" : "",
							(v) => updateParam("include_free", v),
							<>
								<SelectItem value="all">仅作业</SelectItem>
								<SelectItem value="1">含自主训练</SelectItem>
							</>,
						)}
						{filterSelect(
							"排序",
							sortBy,
							(v) => updateParam("sort_by", v),
							SORT_OPTIONS.map((o) => (
								<SelectItem key={o.value} value={o.value}>
									{o.label}
								</SelectItem>
							)),
						)}
						{filterSelect(
							"层次",
							tier,
							(v) => updateParam("tier", v),
							TIER_OPTIONS.map((o) => (
								<SelectItem key={o.value} value={o.value}>
									{o.label}
								</SelectItem>
							)),
						)}
						<div className="flex items-center gap-2">
							<div className="relative">
								<Search
									size={14}
									className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
								/>
								<Input
									value={searchInput}
									onChange={(e) => setSearchInput(e.target.value)}
									onKeyDown={(e) => e.key === "Enter" && applySearch()}
									placeholder="姓名/学号检索"
									className="h-7 w-40 pl-7 text-sm"
								/>
							</div>
							<Button variant="ghost" size="sm" onClick={applySearch}>
								检索
							</Button>
							{search && (
								<Button
									variant="ghost"
									size="icon"
									title="清除检索"
									onClick={() => {
										setSearchInput("");
										updateParam("search", "");
									}}
								>
									<X size={14} />
								</Button>
							)}
						</div>
					</div>
				</CardContent>
			</Card>

			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<StatCard icon={Zap} value={summary?.record_count ?? "-"} label="计入训练次数" color="blue" />
				<StatCard icon={Users} value={summary?.student_count ?? "-"} label="入榜学生" color="teal" />
				<StatCard
					icon={Medal}
					value={summary?.avg_score ?? "-"}
					label="学生平均分"
					color="green"
				/>
				<StatCard
					icon={Clock}
					value={formatDuration(summary?.avg_duration_seconds)}
					label="平均用时"
					color="amber"
				/>
			</div>

			<TierDistribution summary={summary} />

			<Card>
				<CardContent className="p-0">
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
						emptyIcon={TrendingUp}
						emptyTitle="暂无成绩数据"
						emptyDescription="调整筛选范围，或等待学生完成训练并评分后重试"
						renderCard={(r) => (
							<div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
								<div className="flex min-w-0 items-center gap-3">
									{rankBadge(r.rank)}
									<div className="min-w-0">
										<p className="truncate font-medium text-foreground">
											{r.display_name}
										</p>
										<p className="text-xs text-muted-foreground">
											{r.class_name || "—"} · {r.training_count} 次 ·{" "}
											{formatDuration(r.avg_duration_seconds)}
										</p>
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-2">
									{avgScoreCell(r)}
									{tierCell(r.tier)}
									<Button
										variant="ghost"
										size="icon"
										title="查看趋势"
										onClick={() => setTrendUserId(r.user_id)}
									>
										<ChartLine size={16} />
									</Button>
								</div>
							</div>
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
		</div>
	);
}
