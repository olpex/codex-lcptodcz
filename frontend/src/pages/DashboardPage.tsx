import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { InlineNotice } from "../components/InlineNotice";
import { KpiBarChart } from "../components/KpiBarChart";
import { KpiSparkline } from "../components/KpiSparkline";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { usePageRefresh } from "../hooks/usePageRefresh";
import type { KPI } from "../types/api";

const EMPTY_KPI: KPI = {
  active_groups: 0,
  active_trainees: 0,
  facility_load_pct: 0,
  training_plan_progress_pct: 0,
  forecast_graduation: 0,
  forecast_employment: 0
};

const HISTORY_LIMIT = 12;

const KPI_CARDS = [
  {
    key: "active_groups",
    title: "Активні групи",
    formatValue: (value: number) => String(value),
    deltaSuffix: ""
  },
  {
    key: "active_trainees",
    title: "Активні слухачі",
    formatValue: (value: number) => String(value),
    deltaSuffix: ""
  },
  {
    key: "facility_load_pct",
    title: "Завантаженість бази",
    formatValue: (value: number) => `${value}%`,
    deltaSuffix: " п.п."
  },
  {
    key: "training_plan_progress_pct",
    title: "Виконання плану",
    formatValue: (value: number) => `${value}%`,
    deltaSuffix: " п.п."
  }
] as const;

type CardKey = (typeof KPI_CARDS)[number]["key"];

function formatDelta(delta: number | null, suffix = ""): string {
  if (delta == null) return "Немає динаміки";
  if (delta === 0) return "Без змін";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta}${suffix}`;
}

export function DashboardPage() {
  const { request } = useAuth();
  const { showError } = useToast();
  const [kpi, setKpi] = useState<KPI>(EMPTY_KPI);
  const [history, setHistory] = useState<KPI[]>([]);
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
      setHistory((prev) => {
        const next = [...prev, data];
        if (next.length <= HISTORY_LIMIT) return next;
        return next.slice(next.length - HISTORY_LIMIT);
      });
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
  }, []);

  usePageRefresh(() => fetchKpi(true), { intervalMs: 15_000 });

  const chartData = [
    { name: "Групи", value: kpi.active_groups },
    { name: "Слухачі", value: kpi.active_trainees },
    { name: "Випуск", value: kpi.forecast_graduation },
    { name: "Працевлашт.", value: kpi.forecast_employment }
  ];

  const seriesByKey = useMemo<Record<CardKey, number[]>>(
    () => ({
      active_groups: history.map((item) => item.active_groups),
      active_trainees: history.map((item) => item.active_trainees),
      facility_load_pct: history.map((item) => item.facility_load_pct),
      training_plan_progress_pct: history.map((item) => item.training_plan_progress_pct)
    }),
    [history]
  );

  return (
    <div className="space-y-5">
      {loadError && (
        <InlineNotice tone="error" text={loadError} actionLabel="Оновити KPI" onAction={() => fetchKpi()} />
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {KPI_CARDS.map((card) => {
          const series = seriesByKey[card.key];
          const currentValue = series.length ? series[series.length - 1] : kpi[card.key];
          const previousValue = series.length > 1 ? series[series.length - 2] : null;
          const delta = previousValue == null ? null : Number((currentValue - previousValue).toFixed(1));
          return (
            <Panel key={card.key} title={card.title}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-4xl font-heading font-bold text-pine">
                  {isLoading && !hasLoadedOnce ? "…" : card.formatValue(currentValue)}
                </p>
                <span
                  className={clsx(
                    "rounded-full px-2 py-1 text-xs font-semibold",
                    delta == null || delta === 0
                      ? "bg-slate-100 text-slate-600"
                      : delta > 0
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-700"
                  )}
                >
                  {formatDelta(delta, card.deltaSuffix)}
                </span>
              </div>
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                <KpiSparkline values={series} label={`${card.title}: міні-графік зміни за останні оновлення`} />
              </div>
              <p className="mt-1 text-xs text-slate-500">Останні {Math.max(1, series.length)} оновлень</p>
            </Panel>
          );
        })}
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
