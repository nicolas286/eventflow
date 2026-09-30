import { createContext, useContext } from "react";
import type { PlatformAction } from "@contracts/platform-admin";

export type SecurityContextValue = {
  runCritical: (
    action: PlatformAction,
    targetId: string,
    label: string,
    execute: (token: string) => Promise<unknown>,
  ) => Promise<void>;
};

export const SecurityContext = createContext<SecurityContextValue | null>(null);

export function usePlatformSecurity() {
  const value = useContext(SecurityContext);
  if (!value) throw new Error("PlatformSecurityProvider manquant");
  return value;
}
