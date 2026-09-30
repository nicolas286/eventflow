import { Outlet } from "react-router-dom";
import PublicFooter from "@shared/ui/components/publicFooter/PublicFooter";
import { ColorSchemeToggle } from "@shared/ui/components/theme/ColorSchemeToggle";
import { useLocalColorScheme } from "@shared/ui/components/theme/useLocalColorScheme";
import "./PublicLayout.css";
import { PlatformAnnouncementBanner } from "@app/modules/platform/components/PlatformAnnouncementBanner";

export function PublicShellLayout() {
  const { colorScheme, toggleColorScheme } = useLocalColorScheme();

  return (
    <div className="publicShellRoot" data-theme={colorScheme}>
      <PlatformAnnouncementBanner audience="public" />
      <ColorSchemeToggle
        colorScheme={colorScheme}
        onToggle={toggleColorScheme}
        className="publicThemeToggle"
      />
      <main className="publicShellMain">
        <Outlet />
      </main>
      <PublicFooter />
    </div>
  );
}
