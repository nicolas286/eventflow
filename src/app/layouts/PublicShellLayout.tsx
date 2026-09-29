import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import PublicFooter from "@shared/ui/components/publicFooter/PublicFooter";
import "./PublicLayout.css";

type PublicColorScheme = "light" | "dark";

const STORAGE_KEY = "eventflow-public-color-scheme";

function getInitialColorScheme(): PublicColorScheme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage can be unavailable in strict privacy modes.
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function PublicShellLayout() {
  const [colorScheme, setColorScheme] = useState<PublicColorScheme>(
    getInitialColorScheme,
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, colorScheme);
    } catch {
      // The preference remains active for the current page session.
    }
  }, [colorScheme]);

  const nextColorScheme = colorScheme === "dark" ? "light" : "dark";

  return (
    <div className="publicShellRoot" data-theme={colorScheme}>
      <button
        type="button"
        className="publicThemeToggle"
        onClick={() => setColorScheme(nextColorScheme)}
        aria-label={`Activer le mode ${nextColorScheme === "dark" ? "sombre" : "clair"}`}
        title={`Activer le mode ${nextColorScheme === "dark" ? "sombre" : "clair"}`}
      >
        <span aria-hidden="true">{colorScheme === "dark" ? "☀" : "☾"}</span>
        <span className="publicThemeToggleLabel">
          {colorScheme === "dark" ? "Mode clair" : "Mode sombre"}
        </span>
      </button>
      <main className="publicShellMain">
        <Outlet />
      </main>
      <PublicFooter />
    </div>
  );
}
