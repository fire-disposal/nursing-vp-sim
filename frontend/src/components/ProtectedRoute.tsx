import { Navigate, Outlet } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import useAuthStore from "@/stores/authStore";

export default function ProtectedRoute() {
	const authed = useAuthStore(useShallow((s) => !!(s.token && s.user)));

	if (!authed) return <Navigate to="/login" replace />;

	return <Outlet />;
}
