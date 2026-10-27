import { Alert, Loader, SegmentedControl, Stack, Tabs, Text } from "@mantine/core";
import { IconAlertTriangle, IconChartBar, IconFolderOpen } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { queryKeys } from "@/api/query-keys";
import { listAdminScenarioPacks } from "@/api/scenario";
import Forbidden from "@/components/ui/forbidden";
import PageHeader from "@/components/ui/page-header";
import useAuthStore from "@/stores/authStore";
import { getApiErrorMessage } from "@/utils/error";
// 管理侧回放复用学生侧的场景/舞台组件（`sc-*` 类），样式只有这一份来源。
// 不引进来时，这些类在 `/scenario-admin` 直接访问（不经由 /scenario）会整片失样式。
import "../scenario.css";
import AdminCaseListPanel from "./AdminCaseListPanel";
import AdminCaseWorkspace, {
	type CaseBlock,
	visibleCaseBlocks,
} from "./AdminCaseWorkspace";
import AdminSessionsPanel from "./AdminSessionsPanel";
import AdminStatsPanel from "./AdminStatsPanel";

/** 顶层两个区。 */
type Area = "cases" | "data";

/**
 * 「会话 / 统计」区的分块（跨病例视图，按病例筛选是可选项，不是前提）。
 *
 * 与病例工作区的分块词表**分开**：这里的分块权限都是 `stats_view`（与后端 `/admin/**`
 * 数据面的 `_DataViewer` 依赖逐字一致：`/admin/sessions`、`/admin/stats`）。
 */
type DataBlock = "sessions" | "stats";
const DATA_BLOCKS: DataBlock[] = ["sessions", "stats"];

/**
 * 病例管理 —— 隐藏路由 `/scenario-admin`，不出现在导航。
 *
 * ── 结构（2026-09-28 重做）────────────────────────────────────────────
 * 顶层只有两个区，**按作用域分**，不再把"按病例"和"全局"摊平成五个平铺页签：
 *
 * - **病例**：病例列表 → 每个病例一个**工作区**（概览 / 编辑 / 会话 / 统计；
 *   图片与散文在「编辑」的页签里）。
 *   病例只有一处选择：工作区头部那一个（写进地址栏 `?case=`）。图片里选过谁、
 *   会话里展开过谁，都在同一个病例上——不存在"切页签选择就没了"。
 * - **会话 / 统计**：跨病例视图（会话列表带**可选**的病例筛选；统计是全局汇总）。
 *
 * 权限口径不变：内容用 `case_manage`、数据用 `stats_view`。两者都缺 → 403 页；
 * 只有一半时只显示属于那一半的区与块（后端也是这么分的，前端不比后端宽松或更严）。
 * 权限门在这里而不是路由表：一个路由只能声明一个权限，而本页需要两个不同的权限。
 *
 * 地址栏就是"现在在哪"的**唯一真源**（`?area=` / `?case=` / `?block=`）：刷新、后退、
 * 把链接发给同事都能回到同一处；非法值一律回落到第一个有权看的块。
 */
export default function ScenarioAdminPage() {
	const permissions = useAuthStore(useShallow((s) => s.permissions));
	const canContent = permissions.includes("case_manage");
	const canData = permissions.includes("stats_view");
	const [searchParams, setSearchParams] = useSearchParams();

	/**
	 * 病例清单**只有这一份**（页面级）：工作区的每个块都从这里拿病例，
	 * 所以不可能出现"两个块各自拉一份、各自选一个病例"的历史问题。
	 */
	const packsQuery = useQuery({
		queryKey: queryKeys.scenario.admin.packs(),
		queryFn: listAdminScenarioPacks,
		// 两个权限都没有时下面直接 403 返回：不发这一次注定被拒的请求
		enabled: canContent || canData,
		retry: false,
	});

	if (!canContent && !canData) {
		return (
			<>
				<PageHeader
					title="情境病例包"
					subtitle="病例、图片与情境数据"
					icon={IconFolderOpen}
				/>
				<Text size="sm" c="dimmed" mb="xs">
					这个页面需要「病例内容管理」或「数据查看」权限：前者管病例与图片，后者看会话与统计。
				</Text>
				<Forbidden />
			</>
		);
	}

	const packs = packsQuery.data ?? [];
	const caseKey = searchParams.get("case");
	const selected =
		caseKey === null ? null : (packs.find((pack) => pack.key === caseKey) ?? null);

	// 默认落在第一个有权限的区：内容侧是「病例」，数据侧是「会话 / 统计」。
	const areaParam = searchParams.get("area");
	const area: Area =
		areaParam === "data"
			? canData
				? "data"
				: "cases"
			: areaParam === "cases"
				? "cases"
				: canContent
					? "cases"
					: "data";

	const blocks = visibleCaseBlocks(permissions);
	const blockParam = searchParams.get("block");
	// 数据区（跨病例）与病例工作区是两套分块词表：各自的合法值各自回落，互不借用。
	// 地址栏仍是唯一真源——非法值一律回落到第一个数据块。
	const dataBlock: DataBlock =
		blockParam !== null && (DATA_BLOCKS as string[]).includes(blockParam)
			? (blockParam as DataBlock)
			: (DATA_BLOCKS[0] ?? "sessions");
	// 病例列表页没有块；工作区是全部有权限的块。
	const caseBlocks: CaseBlock[] = selected === null ? [] : blocks;
	const block: CaseBlock =
		blockParam !== null && (caseBlocks as string[]).includes(blockParam)
			? (blockParam as CaseBlock)
			: (caseBlocks[0] ?? "overview");

	/** 只动地址栏：`patch` 里值为 null 表示删掉这个参数。 */
	const navigateWith = (patch: Record<string, string | null>, replace = false) => {
		const next = new URLSearchParams(searchParams);
		for (const [key, value] of Object.entries(patch)) {
			if (value === null) next.delete(key);
			else next.set(key, value);
		}
		setSearchParams(next, { replace });
	};

	const openCase = (key: string) =>
		navigateWith({ area: "cases", case: key, block: null });

	const areas = [
		{ value: "cases", label: "病例" },
		...(canData ? [{ value: "data", label: "会话 / 统计" }] : []),
	];

	return (
		<Stack gap="md">
			<PageHeader
				title="情境病例包"
				subtitle="实验轨的情境资源（病例、图片与情境数据），与正式病例库分离；内容在各自工作区里管，会话与统计可跨病例看"
				icon={IconFolderOpen}
			/>

			{canData && (
				<Alert
					color="orange"
					variant="light"
					icon={<IconAlertTriangle size={16} />}
				>
					诊断信息（dm_parse、leaked_fact_term 这类原始串）仅维护者可见，
					学生界面只会看到一句人话。请勿把这些原始串截图转发给学生。
				</Alert>
			)}

			{areas.length > 1 && (
				<SegmentedControl
					size="sm"
					value={area}
					onChange={(value) => navigateWith({ area: value, block: null })}
					data={areas}
					aria-label="管理范围"
				/>
			)}

			{area === "data" ? (
				<Tabs
					value={dataBlock}
					onChange={(value) => value && navigateWith({ block: value }, true)}
				>
					<Tabs.List mb="md" className="sc-admin-tabs">
						<Tabs.Tab value="sessions" leftSection={<IconChartBar size={15} />}>
							会话
						</Tabs.Tab>
						<Tabs.Tab value="stats" leftSection={<IconChartBar size={15} />}>
							统计
						</Tabs.Tab>
					</Tabs.List>
					{dataBlock === "stats" ? <AdminStatsPanel /> : <AdminSessionsPanel />}
				</Tabs>
			) : packsQuery.isLoading ? (
				<Stack align="center" py="xl">
					<Loader size="sm" />
				</Stack>
			) : packsQuery.isError ? (
				isAxiosError(packsQuery.error) &&
				packsQuery.error.response?.status === 403 ? (
					// 病例清单走的是数据口径（`GET /admin/packs` 判 `stats_view`）：
					// 缺它就只能到这一步——如实给出 403，而不是一片"读取失败"
					<Forbidden permission="stats_view" />
				) : (
					<Stack align="flex-start" gap="xs">
						<Text size="sm" c="red">
							病例列表读取失败：
							{getApiErrorMessage(packsQuery.error, "请稍后重试")}
						</Text>
						<button
							type="button"
							className="sc-btn"
							onClick={() => packsQuery.refetch()}
						>
							重试
						</button>
					</Stack>
				)
			) : caseKey !== null && selected === null ? (
				<Stack align="flex-start" gap="xs">
					<Text size="sm" c="dimmed">
						没有 `{caseKey}` 这个病例——它可能已经被删掉，或者链接里的 key 写错了。
					</Text>
					<button
						type="button"
						className="sc-btn"
						onClick={() => navigateWith({ case: null, block: null })}
					>
						返回病例列表
					</button>
				</Stack>
			) : selected === null ? (
				<AdminCaseListPanel
					packs={packs}
					loading={false}
					canContent={canContent}
					onOpen={openCase}
				/>
			) : (
				<AdminCaseWorkspace
					pack={selected}
					permissions={permissions}
					block={block}
					onBlock={(next) => navigateWith({ block: next }, true)}
					onBack={() => navigateWith({ case: null, block: null })}
				/>
			)}
		</Stack>
	);
}
