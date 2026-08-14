import { getUserAvatar } from "@/utils/avatar";
import { Group, Stack, Text } from "@mantine/core";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@mantine/core";
import { RoleBadge } from "@/components/ui/role-badge";
import type { UserBrief } from "./types";

interface UserCardProps {
	user: UserBrief;
	selected: boolean;
	onSelect: (id: number, selected: boolean) => void;
	onClick: (user: UserBrief) => void;
}

export default function UserCard({
	user,
	selected,
	onSelect,
	onClick,
}: UserCardProps) {
	return (
		<Card
			size="sm"
			onClick={() => onClick(user)}
			style={{
				cursor: "pointer",
				transition: "box-shadow 0.15s ease",
				...(selected && {
					borderColor: "var(--mantine-color-blue-6)",
					boxShadow: "0 0 0 1px var(--mantine-color-blue-6)",
				}),
			}}
		>
			<CardContent>
				<Group align="flex-start" gap={12} wrap="nowrap">
					<div onClick={(e) => e.stopPropagation()}>
						<Checkbox
							checked={selected}
							onChange={(e) => onSelect(user.id, e.currentTarget.checked)}
							aria-label={`选择 ${user.display_name}`}
						/>
					</div>
					<img
						src={getUserAvatar(user.gender)}
						alt=""
						style={{
							width: 40,
							height: 40,
							borderRadius: "50%",
							objectFit: "cover",
							flexShrink: 0,
						}}
					/>
					<Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
						<Group gap={6} wrap="nowrap">
							<Text size="sm" fw={500} truncate>
								{user.display_name}
							</Text>
							<RoleBadge
								role={user.role}
								label={user.role_display_name || user.role}
							/>
						</Group>
						<Text size="xs" c="dimmed" truncate>
							{user.username}
						</Text>
						{(user.grade_name || user.class_name) && (
							<Text size="xs" c="dimmed">
								{user.grade_name && user.class_name
									? `${user.grade_name} ${user.class_name}`
									: user.class_name || user.grade_name}
								{user.student_id && (
									<span style={{ marginLeft: 8 }}>学号: {user.student_id}</span>
								)}
							</Text>
						)}
						<Text size="xs" c="dimmed">
							{new Date(user.created_at).toLocaleDateString("zh-CN")}
						</Text>
					</Stack>
				</Group>
			</CardContent>
		</Card>
	);
}
