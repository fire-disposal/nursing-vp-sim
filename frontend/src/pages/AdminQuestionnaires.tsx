import { ClipboardCheck } from "lucide-react";
import QuestionnairesTab from "@/components/teacher/QuestionnairesTab";
import PageHeader from "@/components/ui/page-header";

export default function AdminQuestionnaires() {
	return (
		<>
			<PageHeader
				title="问卷管理"
				subtitle="管理前后测问卷模板、分配病例、查看数据"
				icon={ClipboardCheck}
			/>
			<div className="space-y-4 mt-4">
				<QuestionnairesTab />
			</div>
		</>
	);
}
