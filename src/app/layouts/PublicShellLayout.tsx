import { Outlet } from "react-router-dom";
import PublicFooter from "@shared/ui/components/publicFooter/PublicFooter";
import { ColorSchemeToggle } from "@shared/ui/components/theme/ColorSchemeToggle";
import { useLocalColorScheme } from "@shared/ui/components/theme/useLocalColorScheme";
import "./PublicLayout.css";

export function PublicShellLayout() {
  const { colorScheme, toggleColorScheme } = useLocalColorScheme();

  return (
    <div className="publicShellRoot" data-theme={colorScheme}>
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
