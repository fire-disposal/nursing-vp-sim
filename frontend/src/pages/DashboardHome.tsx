import { Navigate } from "react-router-dom";
import useAuthStore from "@/stores/authStore";
import { isAdminPermissions } from "@/utils/permissions";

/**
 * DashboardHome — 角色路由入口
 *
 * 管理员 → /admin
 * 学生   → /training（首页作为训练页第一个 Tab）
 */
export default function DashboardHome() {
	const perms = useAuthStore((s) => s.permissions);
	const isAdmin = isAdminPermissions(perms);

	if (isAdmin) {
		return <Navigate to="/admin" replace />;
	}
	return <Navigate to="/training" replace />;
}
