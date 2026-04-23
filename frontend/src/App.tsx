import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { AppLayout } from "./layouts/AppLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { DraftsPage } from "./pages/DraftsPage";
import { GroupsPage } from "./pages/GroupsPage";
import { LoginPage } from "./pages/LoginPage";
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

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<GuardedLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="groups" element={<GroupsPage />} />
        <Route path="trainees" element={<TraineesPage />} />
        <Route path="schedule" element={<SchedulePage />} />
        <Route path="workload" element={<WorkloadPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="drafts" element={<DraftsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

