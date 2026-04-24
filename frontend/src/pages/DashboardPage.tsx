import { useEffect, useRef, useState } from "react";
import { InlineNotice } from "../components/InlineNotice";
import { KpiBarChart } from "../components/KpiBarChart";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import type { KPI } from "../types/api";

const EMPTY_KPI: KPI = {
  active_groups: 0,
  active_trainees: 0,
  facility_load_pct: 0,
  training_plan_progress_pct: 0,
  forecast_graduation: 0,
  forecast_employment: 0
};

export function DashboardPage() {
  const { request } = useAuth();
  const { showError } = useToast();
  const [kpi, setKpi] = useState<KPI>(EMPTY_KPI);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const lastErrorMessageRef = useRef("");

  const fetchKpi = async (isBackgroundRefresh = false) => {
    if (!isBackgroundRefresh) {
      setIsLoading(true);
    }
    try {
      const data = await request<KPI>("/dashboard/kpi");
      setKpi(data);
      setLoadError(null);
      lastErrorMessageRef.current = "";
    } catch (error) {
      const message = (error as Error).message;
      setLoadError(message);
      if (message !== lastErrorMessageRef.current) {
        showError(message);
        lastErrorMessageRef.current = message;
      }
    } finally {
      setIsLoading(false);
      setHasLoadedOnce(true);
    }
  };

  useEffect(() => {
    fetchKpi();
    const timer = window.setInterval(() => fetchKpi(true), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const chartData = [
    { name: "Групи", value: kpi.active_groups },
    { name: "Слухачі", value: kpi.active_trainees },
    { name: "Випуск", value: kpi.forecast_graduation },
    { name: "Працевлашт.", value: kpi.forecast_employment }
  ];

  return (
    <div className="space-y-5">
      {loadError && (
        <InlineNotice tone="error" text={loadError} actionLabel="Оновити KPI" onAction={() => fetchKpi()} />
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="Активні групи">
          <p className="text-4xl font-heading font-bold text-pine">{isLoading && !hasLoadedOnce ? "…" : kpi.active_groups}</p>
        </Panel>
        <Panel title="Активні слухачі">
          <p className="text-4xl font-heading font-bold text-pine">
            {isLoading && !hasLoadedOnce ? "…" : kpi.active_trainees}
          </p>
        </Panel>
        <Panel title="Завантаженість бази">
          <p className="text-4xl font-heading font-bold text-pine">
            {isLoading && !hasLoadedOnce ? "…" : `${kpi.facility_load_pct}%`}
          </p>
        </Panel>
        <Panel title="Виконання плану">
          <p className="text-4xl font-heading font-bold text-pine">
            {isLoading && !hasLoadedOnce ? "…" : `${kpi.training_plan_progress_pct}%`}
          </p>
        </Panel>
      </div>
      <Panel title="Прогнозні показники">
        {isLoading && !hasLoadedOnce ? (
          <div className="flex h-72 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-600">
            Завантаження KPI...
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <KpiBarChart items={chartData} />
          </div>
        )}
      </Panel>
    </div>
  );
}
