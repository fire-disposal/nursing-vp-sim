import { APP_TIME_ZONE } from "@/utils/date";
import { ActionIcon, Badge, Group, Stack, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { IconBan, IconCheck, IconPencil, IconTrash, IconUserSearch } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@mantine/core";
import { RoleBadge } from "@/components/ui/role-badge";
import { getUserAvatar } from "@/utils/avatar";
import MembershipTags from "./MembershipTags";
import type { UserBrief } from "./types";

interface UserCardProps {
	user: UserBrief;
	selected: boolean;
	onSelect: (id: number, selected: boolean) => void;
	onEdit: (user: UserBrief) => void;
	onDelete: (user: UserBrief) => void;
	onToggleActive: (user: UserBrief) => void;
}

/**
 * 用户卡片。
 *
 * 交互按「显式操作」组织：姓名是指向详情页的链接，右侧提供 详情/编辑/停用-启用/删除 四个明确动作。
 * 此前整卡挂 onClick 打开编辑弹窗（`div` 无 role/tabindex）—— 键盘与读屏用户进不去（审计 UI-A11Y-4），
 * 且卡内复选框与按钮嵌套在可点击容器里语义混乱，故改为显式动作 + 名称链接。
 */
export default function UserCard({
	user,
	selected,
	onSelect,
	onEdit,
	onDelete,
	onToggleActive,
}: UserCardProps) {
	const inactive = user.is_active === false;
	return (
		<Card
			size="sm"
			style={{
				transition: "box-shadow 0.15s ease",
				...(inactive ? { opacity: 0.62 } : {}),
				...(selected && {
					borderColor: "var(--mantine-color-blue-6)",
					boxShadow: "0 0 0 1px var(--mantine-color-blue-6)",
				}),
			}}
		>
			<CardContent>
				<Group align="flex-start" gap={12} wrap="nowrap">
					<Checkbox
						checked={selected}
						onChange={(e) => onSelect(user.id, e.currentTarget.checked)}
						aria-label={`选择 ${user.display_name}`}
					/>
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
							<UnstyledButton
								component={Link}
								to={`/admin/users/${user.id}`}
								title="查看用户详情"
								style={{ minWidth: 0 }}
							>
								<Text size="sm" fw={500} truncate td="underline">
									{user.display_name}
								</Text>
							</UnstyledButton>
							<RoleBadge
								role={user.role}
								label={user.role_display_name || user.role}
							/>
							{inactive && (
								<Badge variant="light" color="gray" size="xs">
									已停用
								</Badge>
							)}
						</Group>
						<Text size="xs" c="dimmed" truncate>
							{user.username}
						</Text>
						{(user.memberships?.length ?? 0) > 0 ? (
							<MembershipTags memberships={user.memberships} />
						) : (
							<Text size="xs" c="dimmed">未加入班级</Text>
						)}
						{user.student_id && (
							<Text size="xs" c="dimmed">学号: {user.student_id}</Text>
						)}
						<Group justify="space-between" align="center" gap={8} mt={6} wrap="nowrap">
							<Text size="xs" c="dimmed">
								{new Date(user.created_at).toLocaleDateString("zh-CN", { timeZone: APP_TIME_ZONE })}
							</Text>
							<Group gap={4} wrap="nowrap">
								<Tooltip label="查看详情">
									<ActionIcon
										component={Link}
										to={`/admin/users/${user.id}`}
										variant="subtle"
										color="gray"
										size="sm"
										aria-label={`查看 ${user.display_name} 的详情`}
									>
										<IconUserSearch size={15} />
									</ActionIcon>
								</Tooltip>
								<Tooltip label="编辑">
									<ActionIcon
										variant="subtle"
										color="gray"
										size="sm"
										onClick={() => onEdit(user)}
										aria-label={`编辑 ${user.display_name}`}
									>
										<IconPencil size={15} />
									</ActionIcon>
								</Tooltip>
								<Tooltip label={inactive ? "启用账号（恢复登录）" : "停用账号（无法登录，数据保留）"}>
									<ActionIcon
										variant="subtle"
										color={inactive ? "green" : "orange"}
										size="sm"
										onClick={() => onToggleActive(user)}
										aria-label={
											inactive
												? `启用 ${user.display_name} 的账号`
												: `停用 ${user.display_name} 的账号`
										}
									>
										{inactive ? <IconCheck size={15} /> : <IconBan size={15} />}
									</ActionIcon>
								</Tooltip>
								<Tooltip label="删除用户">
									<ActionIcon
										variant="subtle"
										color="red"
										size="sm"
										onClick={() => onDelete(user)}
										aria-label={`删除 ${user.display_name}`}
									>
										<IconTrash size={15} />
									</ActionIcon>
								</Tooltip>
							</Group>
						</Group>
					</Stack>
				</Group>
			</CardContent>
		</Card>
	);
}
