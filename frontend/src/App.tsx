import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import {
	BrowserRouter,
	Navigate,
	Outlet,
	Route,
	Routes,
	useNavigate,
} from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import { FeedbackProvider } from "@/components/FeedbackProvider";
import Layout from "@/components/Layout";
import PermissionGuard from "@/components/PermissionGuard";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ConfirmProvider } from "@/components/ui/confirm";
import { Toaster } from "@/components/ui/sonner";
import { onForceLogout } from "@/events";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: { retry: 1, staleTime: 30_000, gcTime: 10 * 60_000 },
	},
});

const Login = lazy(() => import("@/pages/Login"));
const Showcase = lazy(() => import("@/showcase/ShowcasePage"));
const DashboardHome = lazy(() => import("@/pages/DashboardHome"));
const CaseSelect = lazy(() => import("@/pages/CaseSelect"));
const ChatTraining = lazy(() => import("@/pages/ChatTraining"));
const History = lazy(() => import("@/pages/History"));
const RecordDetail = lazy(() => import("@/pages/RecordDetail"));
const QA = lazy(() => import("@/pages/QA"));
const StatsPage = lazy(() =>
	import("@/pages/Stats").then((m) => ({ default: m.StatsPage })),
);
const Admin = lazy(() => import("@/pages/Admin"));
const AdminUsers = lazy(() => import("@/pages/admin/UsersPage"));
const AdminUserDetail = lazy(() => import("@/pages/admin/UserDetailPage"));
const AdminCases = lazy(() => import("@/pages/admin/CasesPage"));
const AdminLLM = lazy(() => import("@/pages/admin/LLMManagementPage"));
const AdminFeedback = lazy(() => import("@/pages/admin/FeedbackPage"));
const AdminGradesClasses = lazy(
	() => import("@/pages/admin/GradesClassesPage"),
);
const AdminRoles = lazy(() => import("@/pages/admin/RolesPage"));
const AdminQuestionnaires = lazy(() => import("@/pages/AdminQuestionnaires"));
const MyResponses = lazy(() => import("@/pages/MyResponses"));
const Profile = lazy(() => import("@/pages/Profile"));
const CostManagement = lazy(() => import("@/pages/admin/CostManagementPage"));
const AssignmentsPage = lazy(() => import("@/pages/admin/AssignmentsPage"));
const PracticesPage = lazy(() => import("@/pages/admin/PracticesPage"));
const SystemOpsPage = lazy(() => import("@/pages/admin/SystemOpsPage"));
const SystemNotificationsPage = lazy(() => import("@/pages/admin/SystemNotificationsPage"));
const AssignmentDetailPage = lazy(
	() => import("@/pages/admin/AssignmentDetailPage"),
);

function ForceLogoutListener() {
	const navigate = useNavigate();
	useEffect(() => onForceLogout(() => navigate("/login", { replace: true })), [navigate]);
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
					<ForceLogoutListener />
					<Toaster />
					<ConfirmProvider>
						<FeedbackProvider>
							<ErrorBoundary>
								<Suspense fallback={<PageLoader />}>
									<Routes>
										<Route path="/login" element={<Login />} />
										<Route path="/showcase" element={<Showcase />} />
										<Route element={<ProtectedRoute />}>
											<Route
												element={
													<Layout>
														<Outlet />
													</Layout>
												}
											>
												<Route index element={<Navigate to="/home" replace />} />
												<Route path="/home" element={<DashboardHome />} />
												<Route path="/cases" element={<CaseSelect />} />
												<Route path="/training/:recordId" element={<ChatTraining />} />
												<Route path="/history" element={<History />} />
												<Route path="/record/:id" element={<RecordDetail />} />
												<Route path="/qa" element={<QA />} />
												<Route path="/stats" element={<StatsPage />} />
												<Route path="/my-responses" element={<MyResponses />} />
												<Route path="/profile" element={<Profile />} />
												{/*
												 * All admin routes are flat under Layout to avoid the
												 * ProtectedRoute layout-route switching bug that caused
												 * sidebar navigation to stop working.
												 *
												 * Permission checks happen via PermissionGuard inside
												 * each page component.  The sidebar already filters links
												 * based on user permissions.
												 */}
												<Route path="/admin" element={<Admin />} />
												<Route path="/admin/system-ops" element={<SystemOpsPage />} />
												<Route
													path="/admin/system-notifications"
													element={<SystemNotificationsPage />}
												/>
												<Route path="/admin/llm" element={<AdminLLM />} />
												<Route path="/admin/costs" element={<CostManagement />} />
												<Route path="/admin/cases" element={<AdminCases />} />
												<Route path="/admin/practices" element={<PracticesPage />} />
												<Route path="/admin/users" element={
													<PermissionGuard permission="user_manage">
														<AdminUsers />
													</PermissionGuard>
												} />
												<Route
													path="/admin/users/:userId"
													element={
													<PermissionGuard permission="user_manage">
														<AdminUserDetail />
													</PermissionGuard>
												}
												/>
												<Route
													path="/admin/grades-classes"
													element={
													<PermissionGuard permission="grade_class_manage">
														<AdminGradesClasses />
													</PermissionGuard>
												}
												/>
												<Route
													path="/admin/feedback"
													element={<AdminFeedback />}
												/>
												<Route path="/admin/roles" element={
													<PermissionGuard permission="role_manage">
														<AdminRoles />
													</PermissionGuard>
												} />
												<Route
													path="/admin/questionnaires"
													element={<AdminQuestionnaires />}
												/>
												<Route
													path="/admin/assignments"
													element={<AssignmentsPage />}
												/>
												<Route
													path="/admin/assignments/:id"
													element={<AssignmentDetailPage />}
												/>
											</Route>
										</Route>
										<Route path="*" element={<Navigate to="/login" replace />} />
									</Routes>
								</Suspense>
							</ErrorBoundary>
						</FeedbackProvider>
					</ConfirmProvider>
				</QueryClientProvider>
			</BrowserRouter>
	);
}
