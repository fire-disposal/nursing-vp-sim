import UsersTab from "@/components/admin/UsersTab";
import useAuthStore from "@/stores/authStore";

/**
 * 用户管理页 = 用户列表本体。
 * 页头由 `UsersTab` 自己渲染：主行动（注册新用户）与列表筛选必须共享同一份状态
 * （导出要跟随筛选），提到父层只会多一层参数搬运。
 */
export default function UsersPage() {
	const userId = useAuthStore((s) => s.user?.id);
	return <>{userId != null && <UsersTab currentUserId={userId} />}</>;
}
