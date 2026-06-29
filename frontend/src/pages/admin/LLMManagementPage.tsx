import { Activity, BarChart3 } from "lucide-react";
import MonitorTab from "@/components/admin/MonitorTab";
import PageHeader from "@/components/ui/page-header";

export default function LLMManagementPage() {
	return (
		<>
			<PageHeader
				title="LLM 调用监控"
				subtitle="查看 LLM 调用记录、用量统计与异常告警"
				icon={Activity}
			/>
			<MonitorTab />
		</>
	);
}
