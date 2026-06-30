import { Users } from "lucide-react";
import UsersTab from "@/components/admin/UsersTab";
import ExportButton from "@/components/ExportButton";
import PageHeader from "@/components/ui/page-header";
import useAuthStore from "@/stores/authStore";

export default function UsersPage() {
	const userId = useAuthStore((s) => s.user?.user_id);
	return (
		<>
			<PageHeader
				title="用户管理"
				subtitle="搜索、注册、编辑和管理所有用户账号"
				icon={Users}
				actions={<ExportButton endpoint="/admin/export" filename="用户列表" />}
			/>
			{userId != null && <UsersTab currentUserId={userId} />}
		</>
	);
}
