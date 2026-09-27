import { Button, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconLock } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { PERMISSION_DEFS } from "@/config/permissions.gen";

interface ForbiddenProps {
	/** 缺失的权限键。给了就显示对应中文名，便于用户直接说清楚"要开什么"。 */
	permission?: string;
}

/**
 * 403 页（**替代静默重定向**）。
 *
 * 背景（`ui-improvement-plan` §F5 / 审计 UI-NAV-5）：无权限访问此前是 `<Navigate to="/home">`，
 * 用户看到的是"页面自己跳走了"，既不知道发生了什么、也不知道该找谁；深链分享给同事时尤其费解。
 * 这里显式说明缺哪一项权限，并给出两条可行动路径（返回上一页 / 回到自己的训练首页）。
 */
export default function Forbidden({ permission }: ForbiddenProps) {
	const navigate = useNavigate();
	const label = permission
		? (PERMISSION_DEFS.find((d) => d.key === permission)?.label ?? permission)
		: null;

	return (
		<Stack align="center" justify="center" gap="xs" py={64} ta="center">
			<ThemeIcon size={56} variant="light" color="gray" radius="md">
				<IconLock size={26} strokeWidth={1.5} />
			</ThemeIcon>
			<Text size="lg" fw={600}>
				没有访问权限
			</Text>
			<Text size="sm" c="dimmed" maw={460}>
				{label
					? `这个页面需要「${label}」权限，你当前的角色没有。`
					: "这个页面需要权限，你当前的角色没有。"}
				可以让管理员在「人员 → 角色管理」里调整，或先回到自己有权限的页面。
			</Text>
			<Group gap="xs" mt={4}>
				<Button variant="default" onClick={() => navigate(-1)}>
					返回上一页
				</Button>
				<Button onClick={() => navigate("/training")}>回到我的训练</Button>
			</Group>
		</Stack>
	);
}
