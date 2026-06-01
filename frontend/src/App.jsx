import { lazy, Suspense, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import { FeedbackProvider } from "./components/FeedbackProvider";
import { ToastProvider } from "./components/Toast";
import { ConfirmProvider } from "./components/ui/ConfirmDialog";
import Login from "./pages/Login";

const DashboardHome = lazy(() => import("./pages/DashboardHome"));
const CaseSelect = lazy(() => import("./pages/CaseSelect"));
const ChatTraining = lazy(() => import("./pages/ChatTraining"));
const History = lazy(() => import("./pages/History"));
const RecordDetail = lazy(() => import("./pages/RecordDetail"));
const QA = lazy(() => import("./pages/QA"));
const Stats = lazy(() => import("./pages/Stats"));
const Admin = lazy(() => import("./pages/Admin"));
const LLMManagementPage = lazy(() => import("./pages/admin/LLMManagementPage"));
const CasesPage = lazy(() => import("./pages/admin/CasesPage"));
const FeedbackPage = lazy(() => import("./pages/admin/FeedbackPage"));
const UsersPage = lazy(() => import("./pages/admin/UsersPage"));
const UserDetailPage = lazy(() => import("./pages/admin/UserDetailPage"));

function PageLoader() {
  return (
    <div className="page-loader">
      <div className="spinner" />
      <p>加载中...</p>
    </div>
  );
}

function ProtectedRoute({ children, role }) {
  const token = localStorage.getItem("token");
  const userStr = localStorage.getItem("user");

  if (!token || !userStr) return <Navigate to="/login" replace />;

  if (role) {
    let user;
    try {
      user = JSON.parse(userStr);
    } catch {
      return <Navigate to="/login" replace />;
    }
    if (user.role !== role) return <Navigate to="/login" replace />;
  }

  return children;
}

export default function App() {
  const [user, setUser] = useState(() => {
    const userStr = localStorage.getItem("user");
    if (userStr) {
      try {
        return JSON.parse(userStr);
      } catch {
        return null;
      }
    }
    return null;
  });

  const handleLogin = (userData) => {
    setUser(userData);
    localStorage.setItem("user", JSON.stringify(userData));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  };

  return (
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <FeedbackProvider>
            <ErrorBoundary>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/login" element={<Login onLogin={handleLogin} />} />

                  <Route
                    path="/home"
                    element={
                      <ProtectedRoute>
                        <DashboardHome user={user} onLogout={handleLogout} />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/cases"
                    element={
                      <ProtectedRoute role="student">
                        <CaseSelect user={user} onLogout={handleLogout} />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/training/:recordId"
                    element={
                      <ProtectedRoute role="student">
                        <ChatTraining user={user} onLogout={handleLogout} />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/history"
                    element={
                      <ProtectedRoute>
                        <History user={user} onLogout={handleLogout} />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/record/:id"
                    element={
                      <ProtectedRoute>
                        <RecordDetail user={user} onLogout={handleLogout} />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/qa"
                    element={
                      <ProtectedRoute>
                        <QA user={user} onLogout={handleLogout} />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/stats"
                    element={
                      <ProtectedRoute>
                        <Stats user={user} onLogout={handleLogout} />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/admin"
                    element={
                      <ProtectedRoute role="teacher">
                        <Admin user={user} onLogout={handleLogout} />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/admin/llm"
                    element={
                      <ProtectedRoute role="teacher">
                        <LLMManagementPage user={user} onLogout={handleLogout} />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/admin/cases"
                    element={
                      <ProtectedRoute role="teacher">
                        <CasesPage user={user} onLogout={handleLogout} />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/admin/users/:userId"
                    element={
                      <ProtectedRoute role="teacher">
                        <UserDetailPage user={user} onLogout={handleLogout} />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/admin/users"
                    element={
                      <ProtectedRoute role="teacher">
                        <UsersPage user={user} onLogout={handleLogout} />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/admin/feedback"
                    element={
                      <ProtectedRoute role="teacher">
                        <FeedbackPage user={user} onLogout={handleLogout} />
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
