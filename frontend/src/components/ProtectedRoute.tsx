import { Center, Loader } from "@mantine/core";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useScoringNotifications } from "@/hooks/useScoringNotifications";
import useAuthStore from "@/stores/authStore";

function ScoringNotificationsSubscriber() {
	useScoringNotifications();
	return null;
}

export default function ProtectedRoute() {
	const authed = useAuthStore(useShallow((s) => !!(s.token && s.user)));
	const sessionReady = useAuthStore((s) => s.sessionReady);
	const location = useLocation();

	if (!authed) {
		const next = `${location.pathname}${location.search}${location.hash}`;
		return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
	}

	// 冷启动恢复会话时权限还在 `/auth/me` revalidation 中？先等它落地。
	// 直接放行会让 RequirePermission 拿持久化里的旧权限快照渲染 403 页
	// （2026-09-28 生产缺陷：新授予的权限被旧快照挡住）。
	if (!sessionReady) {
		return (
			<Center h="100vh">
				<Loader size="md" />
			</Center>
		);
	}

	return (
		<>
			<ScoringNotificationsSubscriber />
			<Outlet />
		</>
	);
}
