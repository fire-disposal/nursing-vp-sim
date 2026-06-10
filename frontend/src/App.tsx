import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import { FeedbackProvider } from "@/components/FeedbackProvider";
import Layout from "@/components/Layout";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { Toaster } from "@/components/ui/sonner";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, gcTime: 10 * 60_000 } },
});

const Login = lazy(() => import("@/pages/Login"));
const DashboardHome = lazy(() => import("@/pages/DashboardHome"));
const CaseSelect = lazy(() => import("@/pages/CaseSelect"));
const ChatTraining = lazy(() => import("@/pages/ChatTraining"));
const History = lazy(() => import("@/pages/History"));
const RecordDetail = lazy(() => import("@/pages/RecordDetail"));
const QA = lazy(() => import("@/pages/QA"));
const StatsPage = lazy(() => import("@/pages/Stats").then((m) => ({ default: m.StatsPage })));
const Admin = lazy(() => import("@/pages/Admin"));
const AdminUsers = lazy(() => import("@/pages/admin/UsersPage"));
const AdminUserDetail = lazy(() => import("@/pages/admin/UserDetailPage"));
const AdminCases = lazy(() => import("@/pages/admin/CasesPage"));
const AdminLLM = lazy(() => import("@/pages/admin/LLMManagementPage"));
const AdminFeedback = lazy(() => import("@/pages/admin/FeedbackPage"));
const AdminGradesClasses = lazy(() => import("@/pages/admin/GradesClassesPage"));
const AdminSchools = lazy(() => import("@/pages/admin/SchoolsPage"));
const AdminRoles = lazy(() => import("@/pages/admin/RolesPage"));
const AdminQuestionnaires = lazy(() => import("@/pages/AdminQuestionnaires"));
const MyResponses = lazy(() => import("@/pages/MyResponses"));
const Profile = lazy(() => import("@/pages/Profile"));
const AdminDebug = lazy(() => import("@/pages/AdminDebugPage"));
const PluginDashboard = lazy(() => import("@/pages/admin/PluginDashboard"));
const ScenarioComposer = lazy(() => import("@/pages/admin/ScenarioComposer"));
const AssignmentsPage = lazy(() => import("@/pages/admin/AssignmentsPage"));
const AssignmentDetailPage = lazy(() => import("@/pages/admin/AssignmentDetailPage"));

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
        <Toaster />
        <ConfirmProvider>
          <FeedbackProvider>
            <ErrorBoundary>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/login" element={<Login />} />
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
                      <Route element={<ProtectedRoute permission="training_access" />}>
                        <Route path="/cases" element={<CaseSelect />} />
                        <Route path="/training/:recordId" element={<ChatTraining />} />
                      </Route>
                      <Route path="/history" element={<History />} />
                      <Route path="/record/:id" element={<RecordDetail />} />
                      <Route path="/qa" element={<QA />} />
                      <Route path="/stats" element={<StatsPage />} />
                      <Route path="/my-responses" element={<MyResponses />} />
                      <Route path="/profile" element={<Profile />} />
                      <Route element={<ProtectedRoute permission="score_review" />}>
                        <Route path="/admin" element={<Admin />} />
                        <Route path="/admin/debug" element={<AdminDebug />} />
                        <Route path="/admin/plugins" element={<PluginDashboard />} />
                        <Route path="/admin/scenarios" element={<ScenarioComposer />} />
                      </Route>
                      <Route element={<ProtectedRoute permission="llm_monitor" />}>
                        <Route path="/admin/llm" element={<AdminLLM />} />
                      </Route>
                      <Route element={<ProtectedRoute permission="case_manage" />}>
                        <Route path="/admin/cases" element={<AdminCases />} />
                      </Route>
                      <Route element={<ProtectedRoute permission="user_manage" />}>
                        <Route path="/admin/users" element={<AdminUsers />} />
                        <Route path="/admin/users/:userId" element={<AdminUserDetail />} />
                      </Route>
                      <Route element={<ProtectedRoute permission="grade_class_manage" />}>
                        <Route path="/admin/grades-classes" element={<AdminGradesClasses />} />
                      </Route>
                      <Route element={<ProtectedRoute permission="feedback_review" />}>
                        <Route path="/admin/feedback" element={<AdminFeedback />} />
                      </Route>
                      <Route element={<ProtectedRoute permission="school_manage" />}>
                        <Route path="/admin/schools" element={<AdminSchools />} />
                      </Route>
                      <Route element={<ProtectedRoute permission="role_manage" />}>
                        <Route path="/admin/roles" element={<AdminRoles />} />
                      </Route>
                      <Route element={<ProtectedRoute permission="questionnaire_manage" />}>
                        <Route path="/admin/questionnaires" element={<AdminQuestionnaires />} />
                      </Route>
                      <Route element={<ProtectedRoute permission="score_review" />}>
                        <Route path="/admin/assignments" element={<AssignmentsPage />} />
                        <Route path="/admin/assignments/:id" element={<AssignmentDetailPage />} />
                      </Route>
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
