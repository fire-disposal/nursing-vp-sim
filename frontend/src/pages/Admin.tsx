import { Settings } from "lucide-react";
import QARecordsTab from "@/components/admin/QARecordsTab";
import PageHeader from "@/components/ui/page-header";

export default function Admin() {
	return (
		<>
			<PageHeader
				title="问答记录"
				subtitle="查看学生在护理问答模块中的提问和回答记录"
				icon={Settings}
			/>
			<QARecordsTab />
		</>
	);
}
