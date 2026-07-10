import { PERMISSION_KEYS, type Permission } from "@/config/permissions.gen";

export type { Permission };
export { PERMISSION_KEYS };

export const STUDENT_TIER_PERMISSIONS = new Set<Permission>([
	"training_access",
	"qa_access",
	"stats_view",
]);

export function isAdminPermissions(permissions: string[]): boolean {
	return permissions.some(
		(p) => !STUDENT_TIER_PERMISSIONS.has(p as Permission),
	);
}
