import { Outlet, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@providers/AuthProvider/useAuth";
import { ColorSchemeToggle } from "@shared/ui/components/theme/ColorSchemeToggle";
import {
  useLocalColorScheme,
  type LocalColorScheme,
} from "@shared/ui/components/theme/useLocalColorScheme";
import "./AdminTheme.css";

export type AdminLayoutOutletContext = {
  colorScheme: LocalColorScheme;
  toggleColorScheme: () => void;
};

export function AdminLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const { colorScheme, toggleColorScheme } = useLocalColorScheme();

  if (loading) return null; // ou loader
  if (!user) return <Navigate to="/admin/login" replace />;

  return (
    <div className="adminThemeRoot" data-theme={colorScheme}>
      {location.pathname.startsWith("/admin/onboarding") ? (
        <ColorSchemeToggle
          colorScheme={colorScheme}
          onToggle={toggleColorScheme}
          className="adminThemeToggle adminThemeToggle--floating"
        />
      ) : null}
      <Outlet
        context={
          {
            colorScheme,
            toggleColorScheme,
          } satisfies AdminLayoutOutletContext
        }
      />
    </div>
  );
}
