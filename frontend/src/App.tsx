import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { lazy, Suspense, useEffect } from "react";
import {
	BrowserRouter,
	Navigate,
	Route,
	Routes,
	useNavigate,
} from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import { FeedbackHost } from "@/components/FeedbackProvider";
import Layout from "@/components/Layout";
import ProtectedRoute from "@/components/ProtectedRoute";
import RequirePermission from "@/components/RequirePermission";
import { ConfirmHost } from "@/components/ui/confirm";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APP_ROUTES } from "@/components/shell/navigation";
import { onForceLogout } from "@/events";
import { usePalette } from "@/hooks/useTheme";
import useAuthStore from "@/stores/authStore";
import { installGlobalTelemetry, setTelemetryUserId } from "@/utils/telemetry";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: 1,
			staleTime: 30_000,
			gcTime: 10 * 60_000,
			// 窗口聚焦不自动 refetch：避免训练/问答页在切标签页回来时
			// 因后台 refetch 触发 isFetching→骨架屏闪烁、打断流式与计时。
			refetchOnWindowFocus: false,
		},
	},
});

const Login = lazy(() => import("@/pages/Login"));
const Showcase = lazy(() => import("@/showcase/ShowcasePage"));

function ForceLogoutListener() {
	const navigate = useNavigate();
	useEffect(
		() => onForceLogout(() => navigate("/login", { replace: true })),
		[navigate],
	);
	return null;
}

/** Apply persisted color palette on mount. No UI. */
function AppPaletteInit() {
	usePalette();
	return null;
}

function TelemetryInit() {
	const userId = useAuthStore((s) => s.user?.user_id ?? 0);
	useEffect(() => {
		installGlobalTelemetry();
	}, []);
	useEffect(() => {
		setTelemetryUserId(userId);
	}, [userId]);
	return null;
}

function PageLoader() {
	return (
		<div className="flex h-screen flex-col items-center justify-center gap-3">
			<div className="size-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
			<p className="text-sm text-muted-foreground">加载中...</p>
		</div>
	);
}

export default function App() {
	return (
		<BrowserRouter>
			<QueryClientProvider client={queryClient}>
				<TooltipProvider>
				<MotionConfig reducedMotion="user">
				<AppPaletteInit />
				<ForceLogoutListener />
				<TelemetryInit />
				<Toaster />
				<ConfirmHost />
				<FeedbackHost />
				<ErrorBoundary>
					<Suspense fallback={<PageLoader />}>
						<Routes>
							<Route path="/login" element={<Login />} />
							<Route path="/showcase" element={<Showcase />} />
							<Route element={<ProtectedRoute />}>
								<Route element={<Layout />}>
									<Route index element={<Navigate to="/training" replace />} />
									{APP_ROUTES.map((r) => (
										<Route
											key={r.path}
											path={r.path}
											element={
												r.permission ? (
													<RequirePermission permission={r.permission}>
														{r.element}
													</RequirePermission>
												) : (
													r.element
												)
											}
										/>
									))}
								</Route>
							</Route>
							<Route path="*" element={<Navigate to="/login" replace />} />
						</Routes>
					</Suspense>
				</ErrorBoundary>
				</MotionConfig>
				</TooltipProvider>
			</QueryClientProvider>
		</BrowserRouter>
	);
}
