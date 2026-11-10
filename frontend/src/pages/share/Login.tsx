import {
	Box,
	Button,
	Group,
	PasswordInput,
	Stack,
	Text,
	TextInput,
	ThemeIcon,
	Title,
} from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { IconArrowRight, IconStethoscope } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import FormMessageBanner from "@/components/ui/form-message-banner";
import { type LoginFormValues, loginSchema } from "@/schemas/auth";
import useAuthStore from "@/stores/authStore";
import { safeNextPath } from "@/utils/login-redirect";
import "./Login.css";

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
		return (
			axiosErr.response?.data?.detail ??
			axiosErr.response?.data?.message ??
			axiosErr.message ??
			"登录失败，请检查网络连接"
		);
	}
	return "登录失败，请检查网络连接";
}

const TRAINING_LOOP = [
	{ index: "01", title: "接诊", desc: "与虚拟患者完成一次完整问诊" },
	{ index: "02", title: "评估", desc: "在情境中做出护理判断" },
	{ index: "03", title: "复盘", desc: "按维度回看对话与评分" },
];

export default function Login() {
	const [error, setError] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const mountedRef = useRef(true);
	const usernameRef = useRef<HTMLInputElement>(null);
	const passwordRef = useRef<HTMLInputElement>(null);
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const nextPath = safeNextPath(searchParams.get("next"));
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
		return <Navigate to={nextPath} replace />;
	}
	if (token && user && !isTokenExpired(token)) {
		return <Navigate to={nextPath} replace />;
	}

	const onSubmit = async (values: LoginFormValues) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setError("");
		try {
			await login(values.username, values.password);
			if (mountedRef.current) {
				navigate(nextPath, { replace: true });
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
		<Box className="login-page">
			<main className="login-frame">
				<section className="login-brand" aria-labelledby="login-title">
					<div className="login-brand__top">
						<Group gap={12} wrap="nowrap">
							<ThemeIcon
								className="login-mark"
								size={42}
								radius="md"
								variant="filled"
								color="brand"
								aria-hidden="true"
							>
								<IconStethoscope size={21} strokeWidth={1.7} />
							</ThemeIcon>
							<div>
								<Text className="login-brand__name">虚拟患者系统</Text>
								<Text className="login-brand__sub">护理临床训练</Text>
							</div>
						</Group>

						<div className="login-brand__copy">
							<Text className="login-eyebrow">Nursing clinical simulation</Text>
							<Title id="login-title" order={1} className="login-headline">
								把问诊，
								<br />
								练成判断。
							</Title>
							<Text className="login-lede">
								在可复盘的对话里完成病史采集、护理评估与临床判断。
							</Text>
						</div>
					</div>

					<div className="login-brand__foot">
						<ol className="login-ledger" aria-label="训练流程">
							{TRAINING_LOOP.map((step) => (
								<li key={step.index} className="login-ledger__row">
									<Text className="login-ledger__index">{step.index}</Text>
									<div>
										<Text className="login-ledger__title">{step.title}</Text>
										<Text className="login-ledger__desc">{step.desc}</Text>
									</div>
								</li>
							))}
						</ol>
						<Text className="login-meta">病史采集 · 护理评估 · 评分复盘</Text>
					</div>
				</section>

				<section className="login-form-panel" aria-labelledby="login-form-title">
					<div className="login-form-wrap">
						<div>
							<Text className="login-eyebrow">Account access</Text>
							<Title id="login-form-title" order={2} className="login-form-title">
								登录
							</Title>
							<Text className="login-form-lede">使用院校分配的账号进入训练。</Text>
						</div>

						<FormMessageBanner type="error" message={error} />

						<form
							className="login-form"
							onSubmit={form.onSubmit(onSubmit, (errors) => {
								if (errors.username) usernameRef.current?.focus();
								else if (errors.password) passwordRef.current?.focus();
							})}
						>
							<Stack gap="lg">
								<TextInput
									ref={usernameRef}
									type="text"
									name="username"
									label="用户名"
									aria-required="true"
									placeholder="输入用户名"
									autoComplete="username"
									autoFocus
									size="md"
									disabled={isSubmitting}
									styles={{ label: { fontWeight: 600, marginBottom: 6 } }}
									{...form.getInputProps("username")}
									aria-invalid={Boolean(form.errors.username) || undefined}
								/>
								<PasswordInput
									ref={passwordRef}
									name="password"
									label="密码"
									aria-required="true"
									placeholder="输入密码"
									autoComplete="current-password"
									size="md"
									disabled={isSubmitting}
									visibilityToggleFocusable
									styles={{ label: { fontWeight: 600, marginBottom: 6 } }}
									{...form.getInputProps("password")}
									aria-invalid={Boolean(form.errors.password) || undefined}
								/>
								<Button
									type="submit"
									size="md"
									fullWidth
									loading={isSubmitting}
									rightSection={!isSubmitting && <IconArrowRight size={17} strokeWidth={1.8} />}
								>
									{isSubmitting ? "正在进入" : "进入系统"}
								</Button>
							</Stack>
						</form>

						<div className="login-footnote">
							<Text>账号由教师或管理员分配。</Text>
							<Text>忘记密码请联系管理员重置。</Text>
						</div>

						<span className="login-sr-only" role="status" aria-live="polite">
							{isSubmitting ? "正在登录" : ""}
						</span>
					</div>
				</section>
			</main>
		</Box>
	);
}
