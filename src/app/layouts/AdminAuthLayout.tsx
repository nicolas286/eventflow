import { Outlet, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@providers/AuthProvider/useAuth";
import { MessageBox } from "@ui/components/message/MessageBox";
import { ColorSchemeToggle } from "@shared/ui/components/theme/ColorSchemeToggle";
import { useLocalColorScheme } from "@shared/ui/components/theme/useLocalColorScheme";
import "@app/modules/admin/auth/pages/auth.desktop.css";

export function AdminAuthLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const { colorScheme, toggleColorScheme } = useLocalColorScheme();

  const isResetRoute = location.pathname === "/admin/reset-password";

  if (loading) {
    return (
      <div className="authThemeRoot" data-theme={colorScheme}>
        <div className="auth-layoutLoading">
          <MessageBox variant="info">Chargement…</MessageBox>
        </div>
      </div>
    );
  }

  if (user && !isResetRoute) return <Navigate to="/admin" replace />;

  return (
    <div className="authThemeRoot" data-theme={colorScheme}>
      <ColorSchemeToggle
        colorScheme={colorScheme}
        onToggle={toggleColorScheme}
        className="authThemeToggle"
      />
      <Outlet />
    </div>
  );
}
