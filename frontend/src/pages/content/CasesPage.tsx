import { Button } from "@mantine/core";
import { IconPlus, IconUserSearch, IconWand } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useState } from "react";
import CasesTab from "@/components/admin/CasesTab";
import { newCasePath } from "@/components/admin/cases/CaseForm";
import ExportButton from "@/components/ExportButton";
import PageHeader from "@/components/ui/page-header";

export default function CasesPage() {
	// 导出跟随列表筛选（筛选状态在 CasesTab 里，故由它回传）
	const [exportParams, setExportParams] = useState<Record<string, unknown>>({});
	return (
		/* 页头由 CasesPage 排版（标题/副标题是页面级信息）。
		   新建/AI 生成是**真链接**：/admin/cases/new 与 /admin/cases/new?mode=ai，
		   病例库列表不再持有编辑器状态。 */
		<CasesTab
			onExportParamsChange={setExportParams}
			renderHeader={() => (
				<PageHeader
					title="病例库"
					subtitle="正式训练病例：创建、编辑与管理虚拟患者病例"
					icon={IconUserSearch}
					actions={
						<>
							{/* 层级：本页唯一 filled = 新建病例；导出与 AI 生成都是并列的次要动作 */}
							<ExportButton endpoint="/cases/export" filename="病例列表" params={exportParams} />
							<Button
								component={Link}
								to={newCasePath({ ai: true })}
								variant="default"
								size="sm"
								leftSection={<IconWand size={14} />}
							>
								AI 生成
							</Button>
							<Button
								component={Link}
								to={newCasePath()}
								size="sm"
								leftSection={<IconPlus size={14} />}
							>
								新建病例
							</Button>
						</>
					}
				/>
			)}
		/>
	);
}
