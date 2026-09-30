import { Outlet, Navigate } from "react-router-dom";
import { useAuth } from "@providers/AuthProvider/useAuth";
import { ColorSchemeToggle } from "@shared/ui/components/theme/ColorSchemeToggle";
import { useLocalColorScheme } from "@shared/ui/components/theme/useLocalColorScheme";
import "./AdminTheme.css";
import { PlatformAnnouncementBanner } from "@app/modules/platform/components/PlatformAnnouncementBanner";

export function AdminLayout() {
  const { user, loading } = useAuth();
  const { colorScheme, toggleColorScheme } = useLocalColorScheme();

  if (loading) return null; // ou loader
  if (!user) return <Navigate to="/admin/login" replace />;

  return (
    <div className="adminThemeRoot" data-theme={colorScheme}>
      <PlatformAnnouncementBanner audience="organizer" />
      <ColorSchemeToggle
        colorScheme={colorScheme}
        onToggle={toggleColorScheme}
        className="adminThemeToggle"
      />
      <Outlet />
    </div>
  );
}
