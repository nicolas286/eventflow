import { useEffect, useState } from "react";
import type { PlatformPublicConfig } from "@contracts/platform-admin";
import { getPlatformPublicConfig } from "../data/platformAdminRepo";
import "./platformAnnouncementBanner.css";

export function PlatformAnnouncementBanner({ audience }: { audience: "public" | "organizer" }) {
  const [config, setConfig] = useState<PlatformPublicConfig | null>(null);
  useEffect(() => {
    let active = true;
    void getPlatformPublicConfig(audience).then((value) => { if (active) setConfig(value); }).catch(() => { /* the server gate remains authoritative */ });
    return () => { active = false; };
  }, [audience]);
  if (!config) return null;
  const announcement = config.announcement;
  if (!announcement && config.registrationsOpen) return null;
  const level = announcement?.level ?? "maintenance";
  const registrationsClosed = !config.registrationsOpen;
  return <aside className={`platformPublicNotice platformPublicNotice--${level}`} role={level === "information" ? "status" : "alert"}>
    <strong>{announcement?.title ?? "Information Eventflow"}{registrationsClosed ? " · Inscriptions fermées" : ""}</strong>
    <span>{announcement?.body}{announcement && registrationsClosed ? " — " : ""}{registrationsClosed ? config.registrationPublicMessage : ""}</span>
  </aside>;
}
