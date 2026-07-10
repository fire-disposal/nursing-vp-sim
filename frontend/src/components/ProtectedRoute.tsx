import { Navigate, Outlet } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useScoringNotifications } from "@/hooks/useScoringNotifications";
import useAuthStore from "@/stores/authStore";

function ScoringNotificationsSubscriber() {
	useScoringNotifications();
	return null;
}

export default function ProtectedRoute() {
	const authed = useAuthStore(useShallow((s) => !!(s.token && s.user)));

	if (!authed) return <Navigate to="/login" replace />;

	return (
		<>
			<ScoringNotificationsSubscriber />
			<Outlet />
		</>
	);
}
