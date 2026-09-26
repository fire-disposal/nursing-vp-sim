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
				title="系统反馈"
				subtitle="用户对系统本身的问题与建议（bug、功能、评分与内容错误等）"
				icon={IconMessageCircle}
				actions={<ExportButton endpoint="/admin/feedback/export" filename="系统反馈" params={exportParams} />}
			/>
			<FeedbackTab onExportParamsChange={setExportParams} />
		</>
	);
}
