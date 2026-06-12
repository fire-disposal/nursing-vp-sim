import { MessageSquare } from "lucide-react";
import FeedbackTab from "@/components/teacher/FeedbackTab";
import PageHeader from "@/components/ui/PageHeader";

export default function FeedbackPage() {
	return (
		<>
			<PageHeader
				title="用户反馈"
				subtitle="查看用户满意度评分与反馈详情"
				icon={MessageSquare}
			/>
			<FeedbackTab />
		</>
	);
}
