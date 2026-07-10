import { type ReactNode, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import LoadingState from "@/components/ui/loading-state";
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
	const [hydrated, setHydrated] = useState(() =>
		useAuthStore.persist.hasHydrated(),
	);

	useEffect(() => {
		if (hydrated) return;
		return useAuthStore.persist.onFinishHydration(() => setHydrated(true));
	}, [hydrated]);

	if (!hydrated) return <LoadingState className="h-full" />;
	if (!hasPerm) return <Navigate to={fallback} replace />;

	return <>{children}</>;
}
