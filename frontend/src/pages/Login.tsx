import { zodResolver } from "@hookform/resolvers/zod";
import { Activity, Stethoscope } from "lucide-react";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, useNavigate } from "react-router-dom";
import LoginIllustration from "@/components/login/LoginIllustration";
import { Button } from "@/components/ui/Button";
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

function isTokenExpired(token: string): boolean {
	try {
		const payload = JSON.parse(atob(token.split(".")[1]));
		return payload.exp * 1000 < Date.now();
	} catch {
		return true;
	}
}

export default function Login() {
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);
	const isSubmitting = useRef(false);
	const navigate = useNavigate();
	const login = useAuthStore((s) => s.login);
	const user = useAuthStore((s) => s.user);
	const token = useAuthStore((s) => s.token);

	const form = useForm<LoginFormValues>({
		resolver: zodResolver(loginSchema),
		defaultValues: { username: "", password: "" },
	});

	if (token && user && !isTokenExpired(token)) {
		return <Navigate to="/home" replace />;
	}

	const onSubmit = async (values: LoginFormValues) => {
		if (isSubmitting.current) return;
		isSubmitting.current = true;
		setError("");
		setLoading(true);
		try {
			await login(values.username, values.password);
			navigate("/home");
		} catch (err: unknown) {
			if (import.meta.env.DEV) console.error("[Login] failed:", err);
			const axiosErr = err as {
				response?: { data?: { message?: string } };
				message?: string;
			};
			setError(
				axiosErr.response?.data?.message || axiosErr.message || "登录失败",
			);
		} finally {
			setLoading(false);
			isSubmitting.current = false;
		}
	};

	return (
		<div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50/30 to-sky-50">
			<div className="absolute inset-0 bg-grid-medical" />

			<div
				className="absolute size-72 rounded-full bg-blue-400/10 blur-2xl animate-float"
				style={{ left: "-5%", top: "15%" }}
			/>
			<div
				className="absolute size-96 rounded-full bg-teal-400/6 blur-2xl animate-float-delayed"
				style={{ right: "-5%", bottom: "5%" }}
			/>
			<div
				className="absolute size-64 rounded-full bg-indigo-300/6 blur-2xl animate-breathe"
				style={{ left: "40%", top: "40%" }}
			/>

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
							<div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-600">
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
													{...field}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<Button
									type="submit"
									disabled={loading}
									className="h-11 w-full"
								>
									{loading ? "登录中..." : "登 录"}
								</Button>
							</form>
						</Form>
					</div>

					<p className="mt-6 text-center text-xs text-muted-foreground lg:text-left lg:pl-0">
						虚拟患者 · 护理教学平台
					</p>
				</div>
			</div>
		</div>
	);
}
