import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { uiText } from "../i18n/uk";

const NAV_ITEMS = [
  { to: "/", label: uiText.menu.dashboard, roles: ["admin", "methodist", "teacher"] as const },
  { to: "/profile", label: uiText.menu.profile, roles: ["admin", "methodist", "teacher"] as const },
  { to: "/groups", label: uiText.menu.groups, roles: ["admin", "methodist"] as const },
  { to: "/trainees", label: uiText.menu.trainees, roles: ["admin", "methodist"] as const },
  { to: "/orders", label: uiText.menu.orders, roles: ["admin", "methodist"] as const },
  { to: "/schedule", label: uiText.menu.schedule, roles: ["admin", "methodist", "teacher"] as const },
  { to: "/workload", label: uiText.menu.workload, roles: ["admin", "methodist", "teacher"] as const },
  { to: "/performance", label: uiText.menu.performance, roles: ["admin", "methodist", "teacher"] as const },
  { to: "/documents", label: uiText.menu.documents, roles: ["admin", "methodist"] as const },
  { to: "/drafts", label: uiText.menu.drafts, roles: ["admin", "methodist"] as const }
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const userRoles = user?.roles.map((role) => role.name) || [];
  const roles = userRoles.join(", ") || "—";
  const visibleItems = NAV_ITEMS.filter((item) => item.roles.some((role) => userRoles.includes(role)));
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#d8ecf2_0%,#f2f7f5_45%,#ffffff_100%)] text-ink">
      <header className="border-b border-pine/10 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <p className="font-heading text-2xl font-bold text-pine">{uiText.appTitle}</p>
            <p className="text-sm text-slate-600">{uiText.appSubtitle}</p>
          </div>
          <div className="text-right">
            <p className="font-semibold">{user?.full_name}</p>
            <p className="text-sm text-slate-500">Ролі: {roles}</p>
            <button className="mt-2 rounded-lg bg-pine px-3 py-1.5 text-sm text-white" onClick={logout}>
              {uiText.actions.logout}
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 px-4 py-6 md:grid-cols-[220px_1fr]">
        <aside className="rounded-2xl bg-white p-3 shadow-card">
          <nav className="space-y-1">
            {visibleItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `block rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    isActive ? "bg-pine text-white" : "text-slate-700 hover:bg-mist"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="space-y-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
