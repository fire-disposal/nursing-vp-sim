import { Navigate } from "react-router-dom";
import { resolveLandingPath } from "@/components/shell/navigation";
import useAuthStore from "@/stores/authStore";
import { usePersonaStore } from "@/stores/personaStore";

/**
 * DashboardHome — 会话的落地路由。
 *
 * 落点由**当前视角真正能进的导航条目**决定（`resolveLandingPath`），而不是
 * "有没有非学生权限就跳 /admin"：平台与运维视角没有 `stats_view`，按旧口径
 * 一登录就撞 403。登录、刷新、切视角、切院校结束后都回到这里重新分派。
 */
export default function DashboardHome() {
	const permissions = useAuthStore((s) => s.permissions);
	const persona = usePersonaStore((s) => s.active);
	return <Navigate to={resolveLandingPath(permissions, persona)} replace />;
}
