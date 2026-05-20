import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { PAGE_REFRESH_EVENT } from "../hooks/usePageRefresh";
import { uiText } from "../i18n/uk";

const JOURNAL_AUTO_PUMP_INTERVAL_MS = 30_000;

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
  { to: "/journals", label: uiText.menu.journals, roles: ["admin", "methodist"] as const },
  { to: "/jobs", label: uiText.menu.jobs, roles: ["admin", "methodist"] as const },
  { to: "/drafts", label: uiText.menu.drafts, roles: ["admin", "methodist"] as const },
  { to: "/search", label: uiText.menu.search, roles: ["admin", "methodist", "teacher"] as const }
];

export function AppLayout() {
  const { user, logout, request } = useAuth();
  const { showInfo } = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuCloseButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuPanelRef = useRef<HTMLElement>(null);
  const userRoles = user?.roles.map((role) => role.name) || [];
  const roles = userRoles.join(", ") || "—";
  const visibleItems = NAV_ITEMS.filter((item) => item.roles.some((role) => userRoles.includes(role)));

  const handleLogout = async () => {
    await logout();
    setMobileMenuOpen(false);
    showInfo("Ви вийшли з системи");
  };

  const refreshCurrentPage = () => {
    window.dispatchEvent(new Event(PAGE_REFRESH_EVENT));
    setMobileMenuOpen(false);
    showInfo("Оновлюю поточну сторінку");
  };

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
    window.setTimeout(() => {
      mobileMenuButtonRef.current?.focus();
    }, 0);
  };

  const handleMobileDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMobileMenu();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }

    const focusableElements = Array.from(
      mobileMenuPanelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []
    ).filter((element) => element.tabIndex >= 0);

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (!firstElement || !lastElement) {
      return;
    }

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  const focusMainContent = () => {
    window.setTimeout(() => {
      document.getElementById("main-content")?.focus();
    }, 0);
  };

  useEffect(() => {
    if (mobileMenuOpen) {
      mobileMenuCloseButtonRef.current?.focus();
    }
  }, [mobileMenuOpen]);

  useEffect(() => {
    const canPumpJournals = userRoles.some((role) => role === "admin" || role === "methodist");
    if (!canPumpJournals) return;

    let inFlight = false;
    const runPump = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await request("/journal-monitors/auto-pump", { method: "POST" });
      } catch {
        // Keep this heartbeat quiet; visible health diagnostics live in Job Center.
      } finally {
        inFlight = false;
      }
    };

    const initialTimerId = window.setTimeout(() => {
      void runPump();
    }, 10_000);
    const intervalId = window.setInterval(() => {
      void runPump();
    }, JOURNAL_AUTO_PUMP_INTERVAL_MS);
    const handleFocus = () => {
      void runPump();
    };

    window.addEventListener("focus", handleFocus);
    return () => {
      window.clearTimeout(initialTimerId);
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [request, userRoles.join("|")]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#d8ecf2_0%,#f2f7f5_45%,#ffffff_100%)] text-ink">
      <a href="#main-content" className="skip-link" onClick={focusMainContent}>
        Перейти до основного контенту
      </a>
      <header className="sticky top-0 z-40 border-b border-pine/10 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="font-heading text-2xl font-bold text-pine">{uiText.appTitle}</h1>
            <p className="text-sm text-slate-600">{uiText.appSubtitle}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              ref={mobileMenuButtonRef}
              type="button"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 md:hidden"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Відкрити меню"
            >
              Меню
            </button>
            <div className="text-right">
              <p className="font-semibold">{user?.full_name}</p>
              <p className="text-sm text-slate-500">Ролі: {roles}</p>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-pine px-3 py-1.5 text-sm font-semibold text-pine"
                  onClick={refreshCurrentPage}
                >
                  Оновити
                </button>
                <button className="rounded-lg bg-pine px-3 py-1.5 text-sm text-white" onClick={handleLogout}>
                  {uiText.actions.logout}
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 px-4 py-6 md:grid-cols-[220px_1fr]">
        <aside className="hidden rounded-2xl bg-white p-3 shadow-card md:block">
          <nav className="space-y-1" aria-label="Головна навігація">
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
        <main id="main-content" className="space-y-5" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 flex bg-ink/40 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobile-navigation-title"
          onKeyDown={handleMobileDialogKeyDown}
        >
          <aside ref={mobileMenuPanelRef} className="h-full w-[86%] max-w-xs bg-white p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <p id="mobile-navigation-title" className="font-heading text-lg font-semibold text-pine">
                Навігація
              </p>
              <button
                ref={mobileMenuCloseButtonRef}
                type="button"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
                onClick={closeMobileMenu}
              >
                Закрити
              </button>
            </div>
            <nav className="space-y-1" aria-label="Мобільна навігація">
              {visibleItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileMenuOpen(false)}
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
          <button
            className="h-full flex-1 cursor-default"
            type="button"
            onClick={closeMobileMenu}
            aria-label="Закрити меню"
            tabIndex={-1}
          />
        </div>
      )}
    </div>
  );
}
