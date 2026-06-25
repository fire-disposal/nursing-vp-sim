import { Badge } from "@/components/ui/badge";

type RoleVariant = "danger" | "info" | "success";

const ROLE_VARIANT: Record<string, RoleVariant> = {
	super_admin: "danger",
	school_admin: "danger",
	teacher: "info",
};

/** Role pill — unifies the duplicated role color logic onto the shared Badge. */
export function RoleBadge({ role, label }: { role: string; label?: string }) {
	return <Badge variant={ROLE_VARIANT[role] ?? "success"}>{label ?? role}</Badge>;
}

export default RoleBadge;
