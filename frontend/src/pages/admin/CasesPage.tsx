import { IconUserSearch } from "@tabler/icons-react";
import CasesTab from "@/components/admin/CasesTab";
import ExportButton from "@/components/ExportButton";
import PageHeader from "@/components/ui/page-header";

export default function CasesPage() {
	return (
		<>
			<PageHeader
				title="病例管理"
				subtitle="创建、编辑和管理虚拟患者病例库"
				icon={IconUserSearch}
				actions={<ExportButton endpoint="/cases/export" filename="病例列表" />}
			/>
			<CasesTab />
		</>
	);
}
