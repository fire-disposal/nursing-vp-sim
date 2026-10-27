import { SegmentedControl, Stack } from "@mantine/core";
import { IconCoins } from "@tabler/icons-react";
import { useSearchParams } from "react-router-dom";
import MonitorTab from "@/components/admin/monitor/MonitorTab";
import PageHeader from "@/components/ui/page-header";
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
 * 成本管理的壳：页签 + 内容。
 * 费用 KPI 只在 `CostDashboard` 里定义一次 —— 页头此前还叠一排来自 `api_secrets`
 * 汇总的同类卡片，两套口径、两个「今日 LLM 费用」，已合并掉。
 */
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
					<CostDashboard />
				</Stack>
			)}
			{tab === "monitor" && <MonitorTab />}
			{tab === "tts" && <VoiceTTSTab />}
			{tab === "export" && <CostExportTab />}
		</>
	);
}
