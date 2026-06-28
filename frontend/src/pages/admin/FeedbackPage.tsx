import { MessageSquare } from "lucide-react";
import FeedbackTab from "@/components/admin/FeedbackTab";
import ExportButton from "@/components/ExportButton";
import PageHeader from "@/components/ui/page-header";

export default function FeedbackPage() {
	return (
		<>
			<PageHeader
				title="用户反馈"
				subtitle="查看用户满意度评分与反馈详情"
				icon={MessageSquare}
				actions={<ExportButton endpoint="/api/admin/feedback/export" filename="用户反馈" />}
			/>
			<FeedbackTab />
		</>
	);
}
