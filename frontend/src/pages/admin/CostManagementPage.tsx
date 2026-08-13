import { IconCoins } from "@tabler/icons-react";
import { useSearchParams } from "react-router-dom";
import MonitorTab from "@/components/admin/monitor/MonitorTab";
import PageHeader from "@/components/ui/page-header";
import Tabs from "@/components/ui/tabs";
import CostDashboard from "@/pages/admin/cost/CostDashboard";
import CostExportTab from "@/pages/admin/cost/CostExportTab";
import LLMAPITab from "@/pages/admin/cost/LLMAPITab";
import VoiceTTSTab from "@/pages/admin/cost/VoiceTTSTab";

type CostTab = "dashboard" | "llm" | "monitor" | "tts" | "export";

const COST_TABS = [
	{ key: "dashboard", label: "总览仪表盘" },
	{ key: "llm", label: "LLM API" },
	{ key: "monitor", label: "调用监控" },
	{ key: "tts", label: "TTS 管理" },
	{ key: "export", label: "导出与检查" },
];

export default function CostManagementPage() {
	const [searchParams, setSearchParams] = useSearchParams();
	const tab = (searchParams.get("tab") || "dashboard") as CostTab;

	const setTab = (t: string) =>
		setSearchParams({ tab: t }, { replace: true });

	return (
		<>
			<PageHeader
				title="成本管理"
				subtitle="LLM API · TTS · 费用总览 · 数据导出"
				icon={IconCoins}
			/>
			<Tabs tabs={COST_TABS} activeTab={tab} onChange={setTab} />
			{tab === "dashboard" && <CostDashboard />}
			{tab === "llm" && <LLMAPITab />}
			{tab === "monitor" && <MonitorTab />}
			{tab === "tts" && <VoiceTTSTab />}
			{tab === "export" && <CostExportTab />}
		</>
	);
}
