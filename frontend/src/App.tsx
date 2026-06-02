import type { ReactNode } from "react";
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { ToastProvider } from "@/components/Toast";
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
const AdminBackup = lazy(() => import("@/pages/admin/BackupPage"));

function PageLoader() {
  return (
    <div className="page-loader">
      <div className="spinner" />
      <p>加载中...</p>
    </div>
  );
}

function ProtectedRoute({ children, role }: { children: ReactNode; role?: "student" | "teacher" }) {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  if (!token || !user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmProvider>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/home" element={<ProtectedRoute><DashboardHome /></ProtectedRoute>} />
              <Route path="/cases" element={<ProtectedRoute role="student"><CaseSelect /></ProtectedRoute>} />
              <Route path="/training/:recordId" element={<ProtectedRoute role="student"><ChatTraining /></ProtectedRoute>} />
              <Route path="/history" element={<ProtectedRoute><History /></ProtectedRoute>} />
              <Route path="/record/:id" element={<ProtectedRoute><RecordDetail /></ProtectedRoute>} />
              <Route path="/qa" element={<ProtectedRoute><QA /></ProtectedRoute>} />
              <Route path="/stats" element={<ProtectedRoute><StatsPage /></ProtectedRoute>} />
              <Route path="/admin" element={<ProtectedRoute role="teacher"><Admin /></ProtectedRoute>} />
              <Route path="/admin/llm" element={<ProtectedRoute role="teacher"><AdminLLM /></ProtectedRoute>} />
              <Route path="/admin/cases" element={<ProtectedRoute role="teacher"><AdminCases /></ProtectedRoute>} />
              <Route path="/admin/users/:userId" element={<ProtectedRoute role="teacher"><AdminUserDetail /></ProtectedRoute>} />
              <Route path="/admin/users" element={<ProtectedRoute role="teacher"><AdminUsers /></ProtectedRoute>} />
              <Route path="/admin/grades-classes" element={<ProtectedRoute role="teacher"><AdminGradesClasses /></ProtectedRoute>} />
              <Route path="/admin/feedback" element={<ProtectedRoute role="teacher"><AdminFeedback /></ProtectedRoute>} />
              <Route path="/admin/backup" element={<ProtectedRoute role="teacher"><AdminBackup /></ProtectedRoute>} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </Suspense>
        </ConfirmProvider>
      </ToastProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}
