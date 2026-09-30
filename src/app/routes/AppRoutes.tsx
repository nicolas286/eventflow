import { Routes, Route, Navigate } from "react-router-dom";
import { AdminRoutes } from "./AdminRoutes";
import { PublicRoutes } from "./PublicRoutes";
import { NotFoundPage } from "@shared/pages/NotFoundPage";
import { PlatformRoutes } from "./PlatformRoutes";

export function AppRoutes() {
  return (
    <Routes>
      {AdminRoutes}
      {PlatformRoutes}
      {PublicRoutes}

      <Route path="/" element={<Navigate to="/admin/login" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
