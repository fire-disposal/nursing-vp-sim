import { Badge, Group, Stack, Text } from "@mantine/core";
import type { MemberRole, UserMembershipItem } from "@/types/store";

const ROLE_LABEL: Record<MemberRole, string> = {
	student: "学习班级",
	teacher: "任教班级",
};
const ROLE_ORDER: MemberRole[] = ["student", "teacher"];

/** 「届别 班级名」标签文本；缺班级信息时降级显示 id。 */
export function membershipLabel(m: UserMembershipItem): string {
	const name = m.class_name || (m.class_id != null ? `班级#${m.class_id}` : "未知班级");
	return m.cohort_label ? `${m.cohort_label} ${name}` : name;
}

interface MembershipTagsProps {
	memberships?: UserMembershipItem[];
	/** 空归属时的占位文案；传 null 则不渲染占位。 */
	emptyText?: string | null;
	size?: "xs" | "sm" | "md";
	direction?: "row" | "column";
	/** 仅展示指定角色的归属。 */
	only?: MemberRole;
}

/**
 * 用户班级归属标签：按成员角色分组（学习班级 / 任教班级），
 * 展示该用户的**全部**班级，不做任何「挑一条」的降级。
 */
export default function MembershipTags({
	memberships,
	emptyText = "未加入班级",
	size = "xs",
	direction = "row",
	only,
}: MembershipTagsProps) {
	const all = memberships ?? [];
	const roles = only ? [only] : ROLE_ORDER;
	const visible = roles
		.map((role) => ({
			role,
			items: all.filter((m) => m.member_role === role),
		}))
		.filter((g) => g.items.length > 0);

	if (visible.length === 0) {
		return emptyText ? (
			<Text size={size} c="dimmed">
				{emptyText}
			</Text>
		) : null;
	}

	return (
		<Stack gap={4}>
			{visible.map(({ role, items }) => (
				<Group key={role} gap={6} wrap="wrap" align="center">
					<Text size={size} c="dimmed" style={{ whiteSpace: "nowrap" }}>
						{ROLE_LABEL[role]}
					</Text>
					{items.map((m) => (
						<Badge
							key={`${role}-${m.class_id ?? membershipLabel(m)}`}
							variant={role === "teacher" ? "light" : "outline"}
							color={role === "teacher" ? "grape" : "blue"}
							size={size}
							style={direction === "row" ? undefined : { display: "block" }}
						>
							{membershipLabel(m)}
						</Badge>
					))}
				</Group>
			))}
		</Stack>
	);
}
