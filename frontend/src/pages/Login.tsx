import { Box, Button, Divider, Group, Paper, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { IconBook2, IconChartBar, IconMessageCircle, IconStethoscope } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Navigate, Link, useNavigate } from "react-router-dom";
import { TextInput } from "@mantine/core";
import { type LoginFormValues, loginSchema } from "@/schemas/auth";
import useAuthStore from "@/stores/authStore";
import FormMessageBanner from "@/components/ui/form-message-banner";
import LoginIllustration from "./LoginIllustration";

function isTokenExpired(token: string): boolean {
	try {
		const payload = JSON.parse(atob(token.split(".")[1]));
		return payload.exp * 1000 < Date.now();
	} catch {
		return true;
	}
}

function extractError(err: unknown): string {
	if (err instanceof Error) {
		const axiosErr = err as {
			response?: { data?: { detail?: string; message?: string } };
			message?: string;
		};
		return axiosErr.response?.data?.detail
			?? axiosErr.response?.data?.message
			?? axiosErr.message
			?? "登录失败，请检查网络连接";
	}
	return "登录失败，请检查网络连接";
}

const FEATURES = [
	{ icon: IconMessageCircle, title: "沉浸式问诊", desc: "与 AI 虚拟患者面对面采集病史" },
	{ icon: IconChartBar, title: "多维评分", desc: "问诊覆盖、沟通技巧、护理诊断逐项评估" },
	{ icon: IconBook2, title: "随时回放", desc: "完整对话回放与改进建议沉淀学习" },
];

export default function Login() {
	const [error, setError] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const mountedRef = useRef(true);
	const navigate = useNavigate();
	const login = useAuthStore((s) => s.login);
	const user = useAuthStore((s) => s.user);
	const token = useAuthStore((s) => s.token);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	const form = useForm<LoginFormValues>({
		initialValues: { username: "", password: "" },
		validate: schemaResolver(loginSchema),
	});

	// Token exists but expired → silent refresh inline
	if (token && !user) {
		return <Navigate to="/home" replace />;
	}
	if (token && user && !isTokenExpired(token)) {
		return <Navigate to="/home" replace />;
	}

	const onSubmit = async (values: LoginFormValues) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setError("");
		try {
			await login(values.username, values.password);
			if (mountedRef.current) {
				navigate("/home", { replace: true });
			}
		} catch (err: unknown) {
			if (mountedRef.current) {
				setError(extractError(err));
			}
		} finally {
			if (mountedRef.current) {
				setIsSubmitting(false);
			}
		}
	};

	return (
		<Box
			mih="100dvh"
			style={{
				position: "relative",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				overflow: "hidden",
				background:
					"radial-gradient(1200px 600px at 85% -10%, var(--mantine-color-brand-1) 0%, transparent 55%), radial-gradient(900px 500px at -10% 110%, var(--mantine-color-brand-0) 0%, transparent 50%), var(--mantine-color-gray-0)",
			}}
		>
			<Group
				justify="center"
				align="center"
				gap={56}
				wrap="nowrap"
				w="100%"
				maw={1080}
				px="md"
				py="lg"
			>
				{/* 品牌展示区（大屏） */}
				<Box visibleFrom="lg" style={{ flex: 1, minWidth: 0, maxWidth: 480 }}>
					<Stack gap="md" align="flex-start">
						<Group gap={14} wrap="nowrap">
							<ThemeIcon
								size={52}
								radius="lg"
								variant="filled"
								style={{ boxShadow: "var(--mantine-shadow-lg)" }}
							>
								<IconStethoscope size={26} />
							</ThemeIcon>
							<Stack gap={0}>
								<Title order={1} size={28} lh={1.2}>
									虚拟患者系统
								</Title>
								<Text size="sm" c="dimmed" mt={2}>
									护理病史采集技能训练平台
								</Text>
							</Stack>
						</Group>

						<LoginIllustration />

						<Stack gap="xs" w="100%">
							{FEATURES.map((f) => (
								<Group key={f.title} gap={12} wrap="nowrap" align="flex-start">
									<ThemeIcon size={34} radius="md" variant="light" color="brand" style={{ flexShrink: 0 }}>
										<f.icon size={17} strokeWidth={1.8} />
									</ThemeIcon>
									<Box>
										<Text size="sm" fw={600}>
											{f.title}
										</Text>
										<Text size="xs" c="dimmed">
											{f.desc}
										</Text>
									</Box>
								</Group>
							))}
						</Stack>
					</Stack>
				</Box>

				{/* 登录卡 */}
				<Paper
					withBorder
					radius="lg"
					p={{ base: "lg", sm: "xl" }}
					w="100%"
					maw={400}
					shadow="md"
					style={{ background: "var(--mantine-color-body)" }}
				>
					<FormMessageBanner type="error" message={error} />

					<form onSubmit={form.onSubmit(onSubmit)}>
						<Stack gap="md">
							<TextInput
								type="text"
								placeholder="用户名"
								autoComplete="username"
								autoFocus
								size="lg"
								disabled={isSubmitting}
								{...form.getInputProps("username")}
							/>
							<TextInput
								type="password"
								placeholder="密码"
								autoComplete="current-password"
								size="lg"
								disabled={isSubmitting}
								{...form.getInputProps("password")}
							/>
							<Button type="submit" disabled={isSubmitting} size="lg" fullWidth mt="xs">
								{isSubmitting ? "登录中..." : "登 录"}
							</Button>
						</Stack>
					</form>

					<Divider my="md" label="体验入口" labelPosition="center" />

					<Stack gap="sm">
						<Button
							component={Link}
							to="/simulation"
							variant="light"
							color="brand"
							fullWidth
							leftSection={<IconStethoscope size={16} />}
						>
							临床推理模拟实验（免登录体验）
						</Button>
						<Text size="xs" c="dimmed" ta="center">
							忘记密码？请联系教师或管理员重置
						</Text>
					</Stack>
				</Paper>
			</Group>
		</Box>
	);
}
