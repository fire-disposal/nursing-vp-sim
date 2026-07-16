import { zodResolver } from "@hookform/resolvers/zod";
import { Activity, Stethoscope } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, useNavigate } from "react-router-dom";
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
		<div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background">

			<div className="relative z-10 flex w-full max-w-5xl items-center gap-8 px-6 py-10">
				<LoginIllustration />

				<div className="w-full lg:w-1/2 flex flex-col items-center lg:items-start">
					<div className="mb-4 sm:mb-8 text-center lg:text-left">
						<div className="flex items-center justify-center gap-3 lg:justify-start">
							<div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/25">
								<Stethoscope size={24} className="text-primary-foreground" />
							</div>
							<div className="flex flex-col gap-0.5">
								<h1 className="text-2xl font-bold tracking-tight">
									虚拟患者系统
								</h1>
								<p className="text-sm text-muted-foreground">
									护理病史采集技能训练平台
								</p>
							</div>
						</div>
					</div>

					<div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
						{error && (
							<div className="mb-4 flex items-center gap-2 rounded-lg border border-danger bg-danger px-3 py-2.5 text-sm text-danger-foreground">
								<Activity size={16} className="shrink-0" />
								<span>{error}</span>
							</div>
						)}

						<Form {...form}>
							<form
								onSubmit={form.handleSubmit(onSubmit)}
								className="space-y-4"
							>
								<FormField
									control={form.control}
									name="username"
									render={({ field }) => (
										<FormItem>
											<FormLabel className="sr-only">用户名</FormLabel>
											<FormControl>
												<Input
													type="text"
													placeholder="用户名"
													autoComplete="username"
													autoFocus
													className="h-11"
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
											<FormLabel className="sr-only">密码</FormLabel>
											<FormControl>
												<Input
													type="password"
													placeholder="密码"
													autoComplete="current-password"
													className="h-11"
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
									className="h-11 w-full"
								>
									{isSubmitting ? "登录中..." : "登 录"}
								</Button>
							</form>
						</Form>
					</div>

					<p className="mt-6 text-center text-xs text-muted-foreground lg:text-left lg:pl-0">
						忘记密码？请联系教师或管理员重置
					</p>
				</div>
			</div>
		</div>
	);
}
