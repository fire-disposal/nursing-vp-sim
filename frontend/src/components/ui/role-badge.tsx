import { Badge } from "@mantine/core";

const ROLE_COLORS: Record<string, string> = {
	super_admin: "red",
	school_admin: "red",
	admin: "red",
	teacher: "blue",
};

/** Role pill — unifies the duplicated role color logic onto Mantine Badge. */
export function RoleBadge({ role, label }: { role: string; label?: string }) {
	return (
		<Badge variant="light" color={ROLE_COLORS[role] ?? "green"}>
			{label ?? role}
		</Badge>
	);
}

export default RoleBadge;
