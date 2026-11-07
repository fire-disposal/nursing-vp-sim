import { Badge, Group } from "@mantine/core";
import { personaLabel, sortPersonas } from "@/utils/personas";

const PERSONA_COLORS: Record<string, string> = {
	student: "blue",
	teacher: "green",
	admin: "red",
	ops: "orange",
	platform: "grape",
};

/**
 * 视角徽章（多值）：账号可被授予多个视角，全部展示 —— 只显示一条会把
 * 「教师 + 管理员」误读成普通教师。
 *
 * 未知取值（后端新增视角而前端未升级）原样显示，不兜底成「学生」：
 * 那会让用户以为自己被降权了。
 */
export function PersonaBadges({
	personas,
	size = "sm",
	empty = "—",
}: {
	personas?: string[] | null;
	size?: "xs" | "sm" | "md";
	empty?: string;
}) {
	const list = sortPersonas(personas ?? []);
	if (list.length === 0) return <Badge variant="light" color="gray" size={size}>{empty}</Badge>;
	return (
		<Group gap={4} wrap="wrap">
			{list.map((p) => (
				<Badge key={p} variant="light" color={PERSONA_COLORS[p] ?? "gray"} size={size}>
					{personaLabel(p) ?? p}
				</Badge>
			))}
		</Group>
	);
}

export default PersonaBadges;
