import { Outlet, Navigate } from "react-router-dom";
import { useAuth } from "@providers/AuthProvider/useAuth";

export function AdminLayout() {
  const { user, loading } = useAuth();

  if (loading) return null; // ou loader
  if (!user) return <Navigate to="/admin/login" replace />;

  return <Outlet />;
}
