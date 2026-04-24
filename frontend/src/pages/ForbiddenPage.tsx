import { useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Panel } from "../components/Panel";

type ForbiddenState = {
  from?: string;
};

export function ForbiddenPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath = useMemo(() => {
    const state = location.state as ForbiddenState | null;
    return state?.from || "";
  }, [location.state]);

  return (
    <Panel title="Доступ заборонено (403)">
      <div className="space-y-4">
        <p className="text-sm text-slate-700">
          У вашої ролі немає прав для перегляду цього розділу.
          {fromPath ? ` Запитаний маршрут: ${fromPath}.` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link className="rounded-lg bg-pine px-4 py-2 text-sm font-semibold text-white" to="/">
            На дашборд
          </Link>
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
            onClick={() => navigate(-1)}
          >
            Повернутися назад
          </button>
        </div>
      </div>
    </Panel>
  );
}
