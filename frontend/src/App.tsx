import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { AppLayout } from "./layouts/AppLayout";
import { AdminResetPage } from "./pages/AdminResetPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { DraftsPage } from "./pages/DraftsPage";
import { ForbiddenPage } from "./pages/ForbiddenPage";
import { GroupsPage } from "./pages/GroupsPage";
import { JobCenterPage } from "./pages/JobCenterPage";
import { LoginPage } from "./pages/LoginPage";
import { OrdersPage } from "./pages/OrdersPage";
import { PerformancePage } from "./pages/PerformancePage";
import { ProfilePage } from "./pages/ProfilePage";
import { SchedulePage } from "./pages/SchedulePage";
import { TraineesPage } from "./pages/TraineesPage";
import { WorkloadPage } from "./pages/WorkloadPage";

function GuardedLayout() {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return <div className="p-6">Завантаження...</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <AppLayout />;
}

function RoleGuard({
  allowedRoles,
  children
}: {
  allowedRoles: Array<"admin" | "methodist" | "teacher">;
  children: JSX.Element;
}) {
  const { user } = useAuth();
  const location = useLocation();
  const userRoles = user?.roles.map((role) => role.name) ?? [];
  const hasAccess = allowedRoles.some((role) => userRoles.includes(role));
  if (!hasAccess) {
    return <Navigate to="/forbidden" replace state={{ from: location.pathname }} />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/login/admin-reset" element={<AdminResetPage />} />
      <Route path="/" element={<GuardedLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="forbidden" element={<ForbiddenPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route
          path="groups"
          element={
            <RoleGuard allowedRoles={["admin", "methodist"]}>
              <GroupsPage />
            </RoleGuard>
          }
        />
        <Route
          path="trainees"
          element={
            <RoleGuard allowedRoles={["admin", "methodist"]}>
              <TraineesPage />
            </RoleGuard>
          }
        />
        <Route
          path="orders"
          element={
            <RoleGuard allowedRoles={["admin", "methodist"]}>
              <OrdersPage />
            </RoleGuard>
          }
        />
        <Route
          path="schedule"
          element={
            <RoleGuard allowedRoles={["admin", "methodist", "teacher"]}>
              <SchedulePage />
            </RoleGuard>
          }
        />
        <Route
          path="workload"
          element={
            <RoleGuard allowedRoles={["admin", "methodist", "teacher"]}>
              <WorkloadPage />
            </RoleGuard>
          }
        />
        <Route
          path="performance"
          element={
            <RoleGuard allowedRoles={["admin", "methodist", "teacher"]}>
              <PerformancePage />
            </RoleGuard>
          }
        />
        <Route
          path="jobs"
          element={
            <RoleGuard allowedRoles={["admin", "methodist"]}>
              <JobCenterPage />
            </RoleGuard>
          }
        />
        <Route
          path="documents"
          element={
            <RoleGuard allowedRoles={["admin", "methodist"]}>
              <DocumentsPage />
            </RoleGuard>
          }
        />
        <Route
          path="drafts"
          element={
            <RoleGuard allowedRoles={["admin", "methodist"]}>
              <DraftsPage />
            </RoleGuard>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
