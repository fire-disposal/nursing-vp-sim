import { Coins } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import CostDashboard from "@/pages/admin/cost/CostDashboard";
import CostExportTab from "@/pages/admin/cost/CostExportTab";
import LLMAPITab from "@/pages/admin/cost/LLMAPITab";
import VoiceServicesTab from "@/pages/admin/cost/VoiceServicesTab";
import PageHeader from "@/components/ui/PageHeader";
import Tabs from "@/components/ui/Tabs";

type CostTab = "dashboard" | "llm" | "voice" | "export";

const COST_TABS = [
	{ key: "dashboard", label: "总览仪表盘" },
	{ key: "llm", label: "LLM API" },
	{ key: "voice", label: "语音服务" },
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
				subtitle="LLM API · 语音服务 · 费用总览 · 数据导出"
				icon={Coins}
			/>
			<Tabs tabs={COST_TABS} activeTab={tab} onChange={setTab} />
			{tab === "dashboard" && <CostDashboard />}
			{tab === "llm" && <LLMAPITab />}
			{tab === "voice" && <VoiceServicesTab />}
			{tab === "export" && <CostExportTab />}
		</>
	);
}
