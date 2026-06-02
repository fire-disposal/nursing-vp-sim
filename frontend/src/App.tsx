import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import { FeedbackProvider } from "./components/FeedbackProvider";
import { ToastProvider } from "./components/Toast";
import { ConfirmProvider } from "./components/ui/ConfirmDialog";
import useAuthStore from "./stores/authStore";
import Login from "./pages/Login";

const DashboardHome = lazy(() => import("./pages/DashboardHome"));
const CaseSelect = lazy(() => import("./pages/CaseSelect"));
const ChatTraining = lazy(() => import("./pages/ChatTraining"));
const History = lazy(() => import("./pages/History"));
const RecordDetail = lazy(() => import("./pages/RecordDetail"));
const QA = lazy(() => import("./pages/QA"));
const StatsPage = lazy(() => import("./pages/Stats").then((m) => ({ default: m.StatsPage })));
const Admin = lazy(() => import("./pages/Admin"));
const LLMManagementPage = lazy(() => import("./pages/admin/LLMManagementPage"));
const CasesPage = lazy(() => import("./pages/admin/CasesPage"));
const FeedbackPage = lazy(() => import("./pages/admin/FeedbackPage"));
const UsersPage = lazy(() => import("./pages/admin/UsersPage"));
const UserDetailPage = lazy(() => import("./pages/admin/UserDetailPage"));
const GradesClassesPage = lazy(() => import("./pages/admin/GradesClassesPage"));
const BackupPage = lazy(() => import("./pages/admin/BackupPage"));

function PageLoader() {
  return (
    <div className="page-loader">
      <div className="spinner" />
      <p>加载中...</p>
    </div>
  );
}

function ProtectedRoute({ children, role }) {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);

  if (!token || !user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to="/login" replace />;

  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
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
                      <ProtectedRoute role="student">
                        <CaseSelect />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/training/:recordId"
                    element={
                      <ProtectedRoute role="student">
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
                      <ProtectedRoute role="teacher">
                        <Admin />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/llm"
                    element={
                      <ProtectedRoute role="teacher">
                        <LLMManagementPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/cases"
                    element={
                      <ProtectedRoute role="teacher">
                        <CasesPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/users/:userId"
                    element={
                      <ProtectedRoute role="teacher">
                        <UserDetailPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/users"
                    element={
                      <ProtectedRoute role="teacher">
                        <UsersPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/grades-classes"
                    element={
                      <ProtectedRoute role="teacher">
                        <GradesClassesPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/feedback"
                    element={
                      <ProtectedRoute role="teacher">
                        <FeedbackPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/admin/backup"
                    element={
                      <ProtectedRoute role="teacher">
                        <BackupPage />
                      </ProtectedRoute>
                    }
                  />

                  <Route path="*" element={<Navigate to="/login" replace />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </FeedbackProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
