import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import useAuthStore from "@/stores/authStore";
import type { Permission } from "@/utils/permissions";

interface RequirePermissionProps {
	permission: Permission;
	children: ReactNode;
	fallback?: string;
}

export default function RequirePermission({
	permission,
	children,
	fallback = "/home",
}: RequirePermissionProps) {
	const hasPerm = useAuthStore(
		useShallow((s) => s.permissions.includes(permission)),
	);

	if (!hasPerm) return <Navigate to={fallback} replace />;

	return <>{children}</>;
}
