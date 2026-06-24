import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import useAuthStore from "@/stores/authStore";

interface PermissionGuardProps {
	permission: string;
	children: ReactNode;
	fallback?: string;
}

/**
 * Page-level permission guard — shows nothing and redirects if user lacks permission.
 *
 * Unlike ProtectedRoute (which uses <Outlet /> and wraps route groups),
 * PermissionGuard wraps individual page content and can be used inside
 * a flat route structure.  This avoids React Router layout-route switching
 * issues that caused sidebar navigation breakage.
 */
export default function PermissionGuard({
	permission,
	children,
	fallback = "/home",
}: PermissionGuardProps) {
	const permissions = useAuthStore((s) => s.permissions);
	const navigate = useNavigate();

	useEffect(() => {
		if (permissions.length > 0 && !permissions.includes(permission)) {
			navigate(fallback, { replace: true });
		}
	}, [permissions, permission, fallback, navigate]);

	if (!permissions.includes(permission)) {
		return null;
	}

	return <>{children}</>;
}
