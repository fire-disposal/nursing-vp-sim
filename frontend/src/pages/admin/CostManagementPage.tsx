import { SimpleGrid, SegmentedControl, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { IconCoin, IconCoins, IconCpu, IconTrendingUp } from "@tabler/icons-react";
import { useSearchParams } from "react-router-dom";
import { fetchSecrets } from "@/api/admin/api-management";
import { queryKeys } from "@/api/query-keys";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import MonitorTab from "@/components/admin/monitor/MonitorTab";
import PageHeader from "@/components/ui/page-header";
import StatCard from "@/components/ui/stat-card";
import CostDashboard from "@/pages/admin/cost/CostDashboard";
import CostExportTab from "@/pages/admin/cost/CostExportTab";
import VoiceTTSTab from "@/pages/admin/cost/VoiceTTSTab";

const COST_TABS = [
	{ key: "dashboard", label: "总览仪表盘" },
	{ key: "monitor", label: "调用监控" },
	{ key: "tts", label: "TTS 管理" },
	{ key: "export", label: "导出与检查" },
] as const;

type CostTab = (typeof COST_TABS)[number]["key"];

/**
 * LLM 密钥维度的成本卡。密钥的增删改已搬到「API 密钥」页（/admin/secrets），
 * 这里只保留费用/调用量读数——成本与凭据是两件事，不该共用一个页签。
 */
function LLMCostSummary() {
	const { data: secrets = [], isLoading } = useQuery({
		queryKey: queryKeys.apiManagement.secrets,
		queryFn: () => fetchSecrets().then((r) => r.data),
		staleTime: 60_000,
	});

	if (isLoading) return <LoadingSkeleton />;

	const totalCostToday = secrets.reduce(
		(sum, s) => sum + (s.total_cost_today || 0),
		0,
	);
	const totalCostMonth = secrets.reduce(
		(sum, s) => sum + (s.monthly_cost_used || 0),
		0,
	);
	const totalCallsToday = secrets.reduce(
		(sum, s) => sum + (s.call_count_today || 0),
		0,
	);
	const totalMonthlyLimit = secrets.reduce(
		(sum, s) => sum + (s.monthly_cost_limit || 0),
		0,
	);
	const budgetPct =
		totalMonthlyLimit > 0
			? ((totalCostMonth / totalMonthlyLimit) * 100).toFixed(1)
			: "0";

	return (
		<SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
			<StatCard
				icon={IconCoin}
				value={`¥${totalCostToday.toFixed(2)}`}
				label="今日 LLM 费用"
				color="blue"
			/>
			<StatCard
				icon={IconTrendingUp}
				value={`¥${totalCostMonth.toFixed(2)}`}
				label="本月 LLM 费用"
				color="blue"
			/>
			<StatCard
				icon={IconCpu}
				value={totalCallsToday}
				label="今日调用次数"
				color="amber"
			/>
			<StatCard
				icon={IconCoin}
				value={`${budgetPct}%`}
				label={`月度预算 (¥${totalMonthlyLimit.toFixed(0)})`}
				color={Number(budgetPct) > 90 ? "red" : "green"}
			/>
		</SimpleGrid>
	);
}

export default function CostManagementPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	// 地址栏是唯一真源；非法 tab（含历史书签 ?tab=llm）一律回落到总览，避免整页空白
	const rawTab = searchParams.get("tab");
	const tab: CostTab = COST_TABS.some((t) => t.key === rawTab)
		? (rawTab as CostTab)
		: "dashboard";

	const setTab = (t: string) =>
		setSearchParams({ tab: t }, { replace: true });

	return (
		<>
			<PageHeader
				title="成本管理"
				subtitle="费用总览 · 调用监控 · TTS · 数据导出"
				icon={IconCoins}
			/>
			<SegmentedControl data={COST_TABS.map((t) => ({ value: t.key, label: t.label }))} value={tab} onChange={setTab} />
			{tab === "dashboard" && (
				<Stack gap="xl" mt="md">
					<LLMCostSummary />
					<CostDashboard />
				</Stack>
			)}
			{tab === "monitor" && <MonitorTab />}
			{tab === "tts" && <VoiceTTSTab />}
			{tab === "export" && <CostExportTab />}
		</>
	);
}
