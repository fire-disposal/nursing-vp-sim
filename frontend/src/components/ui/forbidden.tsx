import { Button, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconLock } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { PERMISSION_DEFS } from "@/config/permissions.gen";
import { usePersonaStore } from "@/stores/personaStore";
import { personaLabel } from "@/utils/personas";

interface ForbiddenProps {
	/** 缺失的权限键。给了就显示对应中文名，便于用户直接说清楚"要开什么"。 */
	permission?: string;
}

/**
 * 403 页（**替代静默重定向**）。
 *
 * 背景（`ui-improvement-plan` §F5 / 审计 UI-NAV-5）：无权限访问此前是 `<Navigate to="/home">`，
 * 用户看到的是"页面自己跳走了"，既不知道发生了什么、也不知道该找谁；深链分享给同事时尤其费解。
 * 这里显式说明缺哪一项权限，并给出两条可行动路径。
 *
 * 权限按**视角**生效，所以文案说"当前视角"而不是"角色"；主行动回 `/home`
 * （由落地路由按当前视角重新分派），不再固定跳 `/training` —— 平台/运维视角没有
 * 训练权限，那样会从 403 跳进另一个 403。
 */
export default function Forbidden({ permission }: ForbiddenProps) {
	const navigate = useNavigate();
	const activePersona = usePersonaStore((s) => s.active);
	const canSwitchPersona = usePersonaStore((s) => s.available.length > 1);
	const persona = personaLabel(activePersona);
	const label = permission
		? (PERMISSION_DEFS.find((d) => d.key === permission)?.label ?? permission)
		: null;
	const subject = persona ? `当前视角「${persona}」` : "当前账号";

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
					? `${subject}没有「${label}」权限。`
					: `${subject}没有访问这个页面的权限。`}
				{canSwitchPersona ? "可以在顶部切换视角；" : ""}
				仍不可用时，请联系管理员在「人员 → 视角管理」里调整授予。
			</Text>
			<Group gap="xs" mt={4}>
				<Button variant="default" onClick={() => navigate(-1)}>
					返回上一页
				</Button>
				<Button onClick={() => navigate("/home")}>回到首页</Button>
			</Group>
		</Stack>
	);
}
