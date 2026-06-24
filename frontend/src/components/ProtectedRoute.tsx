import { Navigate, Outlet } from "react-router-dom";
import useAuthStore from "@/stores/authStore";

/**
 * Login gate — redirects unauthenticated users to /login.
 * Permission checks are now handled by PermissionGuard in each page component.
 */
export default function ProtectedRoute() {
	const user = useAuthStore((s) => s.user);
	const token = useAuthStore((s) => s.token);

	if (!token || !user) return <Navigate to="/login" replace />;

	return <Outlet />;
}
