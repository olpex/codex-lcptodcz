import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { InlineNotice } from "../components/InlineNotice";
import { KpiBarChart } from "../components/KpiBarChart";
import { KpiSparkline } from "../components/KpiSparkline";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { usePageRefresh } from "../hooks/usePageRefresh";
import type { AttentionSummary, KPI, Workload } from "../types/api";

const EMPTY_KPI: KPI = {
  active_groups: 0,
  active_trainees: 0,
  facility_load_pct: 0,
  training_plan_progress_pct: 0,
  forecast_graduation: 0,
  forecast_employment: 0
};

const HISTORY_LIMIT = 12;
const EMPTY_ATTENTION: AttentionSummary = {
  generated_at: "",
  total_count: 0,
  items: []
};

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

type WorkloadTotals = {
  teachers: number;
  currentHours: number;
  annualHours: number;
  remainingHours: number;
  completedPct: number;
};

function formatDelta(delta: number | null, suffix = ""): string {
  if (delta == null) return "Немає динаміки";
  if (delta === 0) return "Без змін";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta}${suffix}`;
}

function attentionToneClass(severity: string): string {
  if (severity === "error") return "bg-red-100 text-red-700";
  if (severity === "warning") return "bg-amber-100 text-amber-700";
  return "bg-sky-100 text-sky-700";
}

function formatAttentionSeverity(severity: string): string {
  if (severity === "error") return "Критично";
  if (severity === "warning") return "Увага";
  return "Інфо";
}

function formatHours(value: number): string {
  return value.toLocaleString("uk-UA", { maximumFractionDigits: 1 });
}

function summarizeWorkload(rows: Workload[]): WorkloadTotals {
  const totals = rows.reduce(
    (acc, row) => {
      acc.currentHours += row.total_hours || 0;
      acc.annualHours += row.annual_load_hours || 0;
      acc.remainingHours += row.remaining_hours || 0;
      return acc;
    },
    { teachers: rows.length, currentHours: 0, annualHours: 0, remainingHours: 0, completedPct: 0 }
  );
  totals.currentHours = Number(totals.currentHours.toFixed(1));
  totals.annualHours = Number(totals.annualHours.toFixed(1));
  totals.remainingHours = Number(totals.remainingHours.toFixed(1));
  totals.completedPct = totals.annualHours > 0 ? Math.min(100, Math.round((totals.currentHours / totals.annualHours) * 100)) : 0;
  return totals;
}

export function DashboardPage() {
  const { request } = useAuth();
  const { showError } = useToast();
  const [kpi, setKpi] = useState<KPI>(EMPTY_KPI);
  const [attention, setAttention] = useState<AttentionSummary>(EMPTY_ATTENTION);
  const [workload, setWorkload] = useState<Workload[]>([]);
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
      const [data, attentionData, workloadData] = await Promise.all([
        request<KPI>("/dashboard/kpi"),
        request<AttentionSummary>("/dashboard/attention"),
        request<Workload[]>("/teacher-workload")
      ]);
      setKpi(data);
      setAttention(attentionData);
      setWorkload(workloadData);
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

  const workloadTotals = useMemo(() => summarizeWorkload(workload), [workload]);
  const workloadRows = useMemo(
    () =>
      [...workload].sort((left, right) =>
        left.teacher_name.localeCompare(right.teacher_name, "uk-UA", { sensitivity: "base" })
      ),
    [workload]
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
      <Panel title="Педнавантаження викладачів">
        {isLoading && !hasLoadedOnce ? (
          <div className="flex h-32 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-600">
            Завантаження навантаження...
          </div>
        ) : workload.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Даних про навантаження ще немає. Додайте розклад або річний план викладачів.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-x-4 gap-y-3 border-y border-slate-200 py-3 md:grid-cols-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Викладачів</p>
                <p className="mt-1 text-2xl font-heading font-bold text-ink">{workloadTotals.teachers}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Поточні години</p>
                <p className="mt-1 text-2xl font-heading font-bold text-pine">{formatHours(workloadTotals.currentHours)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Річний план</p>
                <p className="mt-1 text-2xl font-heading font-bold text-ink">{formatHours(workloadTotals.annualHours)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Залишок</p>
                <p className="mt-1 text-2xl font-heading font-bold text-amber-700">{formatHours(workloadTotals.remainingHours)}</p>
              </div>
            </div>
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="h-2 min-w-[12rem] flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-pine" style={{ width: `${workloadTotals.completedPct}%` }} />
                </div>
                <span className="text-xs font-semibold text-slate-600">{workloadTotals.completedPct}% виконано</span>
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <div className="min-w-[36rem]">
                  <div className="grid grid-cols-[1fr_5rem_5rem_5rem] gap-2 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <span>Викладач</span>
                    <span className="text-right">Поточні</span>
                    <span className="text-right">План</span>
                    <span className="text-right">Залишок</span>
                  </div>
                  <div className="divide-y divide-slate-200 bg-white">
                    {workloadRows.map((row) => (
                      <div key={row.teacher_id} className="grid grid-cols-[1fr_5rem_5rem_5rem] gap-2 px-3 py-2 text-sm">
                        <span className="min-w-0 truncate font-medium text-ink">{row.teacher_name}</span>
                        <span className="text-right text-slate-700">{formatHours(row.total_hours)}</span>
                        <span className="text-right text-slate-700">{formatHours(row.annual_load_hours)}</span>
                        <span
                          className={clsx(
                            "text-right font-semibold",
                            row.remaining_hours < 0
                              ? "text-rose-700"
                              : row.remaining_hours === 0
                                ? "text-emerald-700"
                                : "text-amber-700"
                          )}
                        >
                          {formatHours(row.remaining_hours)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <Link className="mt-3 inline-flex rounded-lg border border-pine px-3 py-2 text-sm font-semibold text-pine" to="/workload">
                Відкрити повне навантаження
              </Link>
            </div>
          </div>
        )}
      </Panel>
      <Panel title="2.7 Що потребує уваги">
        {isLoading && !hasLoadedOnce ? (
          <div className="flex h-24 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-600">
            Завантаження перевірок...
          </div>
        ) : attention.items.length === 0 ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            Немає критичних питань. Дані виглядають охайно.
          </div>
        ) : (
          <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {attention.items.map((item) => (
              <div key={item.key} className="grid gap-3 px-4 py-3 md:grid-cols-[auto_1fr_auto] md:items-center">
                <div className="text-2xl font-heading font-bold text-ink">{item.count}</div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">{item.title}</span>
                    <span className={clsx("rounded-full px-2 py-1 text-xs font-semibold", attentionToneClass(item.severity))}>
                      {formatAttentionSeverity(item.severity)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{item.description}</p>
                </div>
                <Link className="rounded-lg border border-pine px-3 py-2 text-center text-sm font-semibold text-pine" to={item.action_href}>
                  Перейти
                </Link>
              </div>
            ))}
          </div>
        )}
      </Panel>
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
