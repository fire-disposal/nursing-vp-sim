import { Center, Loader, Stack, Text } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
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
import { APP_ROUTES } from "@/components/shell/navigation";
import { onForceLogout } from "@/events";
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
const FaceLab = lazy(() => import("@/pages/face-lab/FaceLabPage"));
const SimulationConsole = lazy(() => import("@/simulations/SimulationConsole"));

function ForceLogoutListener() {
	const navigate = useNavigate();
	useEffect(
		() => onForceLogout(() => navigate("/login", { replace: true })),
		[navigate],
	);
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
		<Center h="100vh">
			<Stack align="center" gap="sm">
				<Loader size="md" />
				<Text size="sm" c="dimmed">
					加载中...
				</Text>
			</Stack>
		</Center>
	);
}

export default function App() {
	return (
		<BrowserRouter>
			<QueryClientProvider client={queryClient}>
				<ModalsProvider>
					<MotionConfig reducedMotion="user">
						<ForceLogoutListener />
						<TelemetryInit />
						<Notifications />
						<FeedbackHost />
						<ErrorBoundary>
							<Suspense fallback={<PageLoader />}>
								<Routes>
									<Route path="/login" element={<Login />} />
									<Route path="/showcase" element={<Showcase />} />
									<Route path="/face-demo" element={<FaceLab />} />
									<Route element={<ProtectedRoute />}>
										<Route
											path="/simulation"
											element={<SimulationConsole />}
										/>
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
				</ModalsProvider>
			</QueryClientProvider>
		</BrowserRouter>
	);
}
