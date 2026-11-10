import { Button, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconMapQuestion } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import useAuthStore from "@/stores/authStore";

/** 未知地址的显式出口：不再把已登录用户送回登录页制造二次跳转。 */
export default function NotFound() {
	const navigate = useNavigate();
	const authed = useAuthStore((s) => Boolean(s.token && s.user));

	return (
		<Stack align="center" justify="center" gap="xs" mih="70vh" py={64} ta="center">
			<ThemeIcon size={56} variant="light" color="gray" radius="md">
				<IconMapQuestion size={26} strokeWidth={1.5} />
			</ThemeIcon>
			<Text size="lg" fw={600}>页面不存在</Text>
			<Text size="sm" c="dimmed" maw={460}>
				链接可能已失效，或页面地址有误。可以返回上一页，或回到可用首页。
			</Text>
			<Group gap="xs" mt={4}>
				<Button variant="default" onClick={() => navigate(-1)}>返回上一页</Button>
				<Button onClick={() => navigate(authed ? "/home" : "/login", { replace: true })}>
					{authed ? "回到首页" : "返回登录"}
				</Button>
			</Group>
		</Stack>
	);
}
