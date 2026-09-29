import { useEffect, useState } from "react";

export type LocalColorScheme = "light" | "dark";

const STORAGE_KEY = "eventflow-color-scheme";
const LEGACY_STORAGE_KEY = "eventflow-public-color-scheme";

function getInitialColorScheme(): LocalColorScheme {
  try {
    const stored =
      window.localStorage.getItem(STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_STORAGE_KEY);

    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage can be unavailable in strict privacy modes.
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function useLocalColorScheme() {
  const [colorScheme, setColorScheme] = useState<LocalColorScheme>(
    getInitialColorScheme,
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, colorScheme);
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // The preference remains active for the current page session.
    }
  }, [colorScheme]);

  return {
    colorScheme,
    toggleColorScheme: () =>
      setColorScheme((current) => (current === "dark" ? "light" : "dark")),
  };
}
