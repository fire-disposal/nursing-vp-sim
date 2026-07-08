import { type ReactNode, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import useAuthStore from "@/stores/authStore";

interface PermissionGuardProps {
	permission: string;
	children: ReactNode;
	fallback?: string;
}

export default function PermissionGuard({
	permission,
	children,
	fallback = "/home",
}: PermissionGuardProps) {
	const hasPerm = useAuthStore(useShallow((s) => s.permissions.includes(permission)));
	const hydrated = useAuthStore.persist.hasHydrated();
	const navigate = useNavigate();

	useEffect(() => {
		if (hydrated && !hasPerm) {
			navigate(fallback, { replace: true });
		}
	}, [hydrated, hasPerm, fallback, navigate]);

	if (!hydrated) return null;
	if (!hasPerm) return null;

	return <>{children}</>;
}
