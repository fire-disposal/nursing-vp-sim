import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import { FeedbackProvider } from "@/components/FeedbackProvider";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { Toaster } from "@/components/ui/sonner";
import useAuthStore from "@/stores/authStore";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
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

function PageLoader() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3">
      <div className="size-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
      <p className="text-sm text-muted-foreground">加载中...</p>
    </div>
  );
}

function ProtectedRoute({ children, role, permission }: { children: ReactNode; role?: string; permission?: string }) {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const permissions = useAuthStore((s) => s.permissions);
  if (!token || !user) return <Navigate to="/login" replace />;

  if (permission && !permissions.includes(permission)) return <Navigate to="/login" replace />;

  if (role && user.role !== role) return <Navigate to="/login" replace />;
  return <>{children}</>;
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
                  <Route
                    path="/home"
                    element={
                      <ProtectedRoute>
                        <DashboardHome />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/cases"
                    element={
                      <ProtectedRoute permission="training_access">
                        <CaseSelect />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/training/:recordId"
                    element={
                      <ProtectedRoute permission="training_access">
                        <ChatTraining />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/history"
                    element={
                      <ProtectedRoute>
                        <History />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/record/:id"
                    element={
                      <ProtectedRoute>
                        <RecordDetail />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/qa"
                    element={
                      <ProtectedRoute>
                        <QA />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/stats"
                    element={
                      <ProtectedRoute>
                        <StatsPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin"
                    element={
                      <ProtectedRoute permission="score_review">
                        <Admin />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/llm"
                    element={
                      <ProtectedRoute permission="llm_monitor">
                        <AdminLLM />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/cases"
                    element={
                      <ProtectedRoute permission="case_manage">
                        <AdminCases />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/users/:userId"
                    element={
                      <ProtectedRoute permission="user_manage">
                        <AdminUserDetail />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/users"
                    element={
                      <ProtectedRoute permission="user_manage">
                        <AdminUsers />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/grades-classes"
                    element={
                      <ProtectedRoute permission="grade_class_manage">
                        <AdminGradesClasses />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/feedback"
                    element={
                      <ProtectedRoute permission="feedback_review">
                        <AdminFeedback />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/schools"
                    element={
                      <ProtectedRoute permission="school_manage">
                        <AdminSchools />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/roles"
                    element={
                      <ProtectedRoute permission="role_manage">
                        <AdminRoles />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/questionnaires"
                    element={
                      <ProtectedRoute permission="questionnaire_manage">
                        <AdminQuestionnaires />
                      </ProtectedRoute>
                    }
                  />
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
