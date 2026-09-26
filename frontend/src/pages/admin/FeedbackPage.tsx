import { IconMessageCircle } from "@tabler/icons-react";
import FeedbackTab from "@/components/admin/FeedbackTab";
import ExportButton from "@/components/ExportButton";
import PageHeader from "@/components/ui/page-header";
import { useState } from "react";

export default function FeedbackPage() {
	// 导出跟随列表筛选（筛选状态在 FeedbackTab 里，故由它回传）
	const [exportParams, setExportParams] = useState<Record<string, unknown>>({});
	return (
		<>
			<PageHeader
				title="用户反馈"
				subtitle="查看用户满意度评分与反馈详情"
				icon={IconMessageCircle}
				actions={<ExportButton endpoint="/admin/feedback/export" filename="用户反馈" params={exportParams} />}
			/>
			<FeedbackTab onExportParamsChange={setExportParams} />
		</>
	);
}
