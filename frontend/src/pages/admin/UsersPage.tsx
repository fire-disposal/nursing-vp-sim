import { IconUsers } from "@tabler/icons-react";
import UsersTab from "@/components/admin/UsersTab";
import ExportButton from "@/components/ExportButton";
import PageHeader from "@/components/ui/page-header";
import useAuthStore from "@/stores/authStore";
import { useState } from "react";

export default function UsersPage() {
	const userId = useAuthStore((s) => s.user?.id);
	// 导出跟随列表筛选（筛选状态在 UsersTab 里，故由它回传）
	const [exportParams, setExportParams] = useState<Record<string, unknown>>({});
	return (
		<>
			<PageHeader
				title="用户管理"
				subtitle="搜索、注册、编辑和管理所有用户账号"
				icon={IconUsers}
				actions={<ExportButton endpoint="/admin/export" filename="用户列表" params={exportParams} />}
			/>
			{userId != null && <UsersTab currentUserId={userId} onExportParamsChange={setExportParams} />}
		</>
	);
}
