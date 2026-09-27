import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import Forbidden from "@/components/ui/forbidden";
import useAuthStore from "@/stores/authStore";
import type { Permission } from "@/utils/permissions";

interface RequirePermissionProps {
	permission: Permission;
	children: ReactNode;
}

/**
 * 路由级权限门禁：缺权限时渲染 **403 页**（而不是静默 redirect）。
 * 见 `components/ui/forbidden.tsx` 的说明。
 */
export default function RequirePermission({
	permission,
	children,
}: RequirePermissionProps) {
	const hasPerm = useAuthStore(
		useShallow((s) => s.permissions.includes(permission)),
	);

	if (!hasPerm) return <Forbidden permission={permission} />;

	return <>{children}</>;
}
