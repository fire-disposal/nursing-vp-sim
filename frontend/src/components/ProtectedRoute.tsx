import { Navigate, Outlet } from "react-router-dom";
import useAuthStore from "@/stores/authStore";

interface ProtectedRouteProps {
  role?: string;
  permission?: string;
}

export default function ProtectedRoute({ role, permission }: ProtectedRouteProps) {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const permissions = useAuthStore((s) => s.permissions);

  if (!token || !user) return <Navigate to="/login" replace />;
  if (permission && !permissions.includes(permission)) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to="/login" replace />;

  return <Outlet />;
}
