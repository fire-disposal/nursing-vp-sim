import { IconUserSearch } from "@tabler/icons-react";
import CasesTab from "@/components/admin/CasesTab";
import ExportButton from "@/components/ExportButton";
import PageHeader from "@/components/ui/page-header";
import { useState } from "react";

export default function CasesPage() {
	// 导出跟随列表筛选（筛选状态在 CasesTab 里，故由它回传）
	const [exportParams, setExportParams] = useState<Record<string, unknown>>({});
	return (
		<>
			<PageHeader
				title="病例管理"
				subtitle="创建、编辑和管理虚拟患者病例库"
				icon={IconUserSearch}
				actions={<ExportButton endpoint="/cases/export" filename="病例列表" params={exportParams} />}
			/>
			<CasesTab onExportParamsChange={setExportParams} />
		</>
	);
}
