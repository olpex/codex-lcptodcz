import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { AppLayout } from "./layouts/AppLayout";

const AdminResetPage = lazy(() =>
  import("./pages/AdminResetPage").then((module) => ({ default: module.AdminResetPage }))
);
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage }))
);
const DocumentsPage = lazy(() =>
  import("./pages/DocumentsPage").then((module) => ({ default: module.DocumentsPage }))
);
const DraftsPage = lazy(() =>
  import("./pages/DraftsPage").then((module) => ({ default: module.DraftsPage }))
);
const ForbiddenPage = lazy(() =>
  import("./pages/ForbiddenPage").then((module) => ({ default: module.ForbiddenPage }))
);
const GroupsPage = lazy(() =>
  import("./pages/GroupsPage").then((module) => ({ default: module.GroupsPage }))
);
const JobCenterPage = lazy(() =>
  import("./pages/JobCenterPage").then((module) => ({ default: module.JobCenterPage }))
);
const LoginPage = lazy(() =>
  import("./pages/LoginPage").then((module) => ({ default: module.LoginPage }))
);
const OrdersPage = lazy(() =>
  import("./pages/OrdersPage").then((module) => ({ default: module.OrdersPage }))
);
const PerformancePage = lazy(() =>
  import("./pages/PerformancePage").then((module) => ({ default: module.PerformancePage }))
);
const ProfilePage = lazy(() =>
  import("./pages/ProfilePage").then((module) => ({ default: module.ProfilePage }))
);
const SchedulePage = lazy(() =>
  import("./pages/SchedulePage").then((module) => ({ default: module.SchedulePage }))
);
const SearchPage = lazy(() =>
  import("./pages/SearchPage").then((module) => ({ default: module.SearchPage }))
);
const TraineesPage = lazy(() =>
  import("./pages/TraineesPage").then((module) => ({ default: module.TraineesPage }))
);
const WorkloadPage = lazy(() =>
  import("./pages/WorkloadPage").then((module) => ({ default: module.WorkloadPage }))
);

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
    <Suspense fallback={<div className="p-6">Завантаження...</div>}>
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
            path="search"
            element={
              <RoleGuard allowedRoles={["admin", "methodist", "teacher"]}>
                <SearchPage />
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
    </Suspense>
  );
}
