import { zodResolver } from "@hookform/resolvers/zod";
import { Anchor, Box, Flex, Group, Paper, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconStethoscope } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
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
		resolver: zodResolver(loginSchema),
		defaultValues: { username: "", password: "" },
		mode: "onSubmit",
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
		<Box mih="100vh" style={{ display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
			<Group
				justify="center"
				align="center"
				gap="lg"
				wrap="nowrap"
				w="100%"
				maw={1024}
				px="md"
				py="lg"
			>
				<LoginIllustration />

				<Flex
					direction="column"
					align={{ base: "center", lg: "flex-start" }}
					flex={1}
					w="100%"
					style={{ minWidth: 0 }}
				>
					<Box mb={{ base: 16, sm: 32 }} ta={{ base: "center", lg: "left" }} w="100%">
						<Group gap="sm" justify="center">
							<ThemeIcon size={48} radius="xl" variant="filled" style={{ boxShadow: "var(--mantine-shadow-lg)" }}>
								<IconStethoscope size={24} />
							</ThemeIcon>
							<Stack gap={2}>
								<Title order={1} size="xl">
									虚拟患者系统
								</Title>
								<Text size="sm" c="dimmed">
									护理病史采集技能训练平台
								</Text>
							</Stack>
						</Group>
					</Box>

					<Paper withBorder radius="xl" p={{ base: "md", sm: "lg" }} w="100%" maw={384} shadow="sm">
						<FormMessageBanner type="error" message={error} />

						<Form {...form}>
							<form onSubmit={form.handleSubmit(onSubmit)}>
								<Stack gap="md">
									<FormField
										control={form.control}
										name="username"
										render={({ field }) => (
											<FormItem>
												<FormLabel style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", borderWidth: 0 }}>用户名</FormLabel>
												<FormControl>
													<Input
														type="text"
														placeholder="用户名"
														autoComplete="username"
														autoFocus
														size="lg"
														disabled={isSubmitting}
														{...field}
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
									<FormField
										control={form.control}
										name="password"
										render={({ field }) => (
											<FormItem>
												<FormLabel style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", borderWidth: 0 }}>密码</FormLabel>
												<FormControl>
													<Input
														type="password"
														placeholder="密码"
														autoComplete="current-password"
														size="lg"
														disabled={isSubmitting}
														{...field}
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
									<Button
										onClick={form.handleSubmit(onSubmit)}
										disabled={isSubmitting}
										size="lg"
										fullWidth
									>
										{isSubmitting ? "登录中..." : "登 录"}
									</Button>
								</Stack>
							</form>
						</Form>
					</Paper>

					<Text size="xs" c="dimmed" mt="lg" ta={{ base: "center", lg: "left" }}>
						忘记密码？请联系教师或管理员重置
					</Text>
					<Anchor
						component={Link}
						to="/simulation"
						size="xs"
						c="teal"
						mt="sm"
						ta={{ base: "center", lg: "left" }}
					>
						临床推理模拟实验（直接体验）→
					</Anchor>
				</Flex>
			</Group>
		</Box>
	);
}
