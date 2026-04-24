import { useEffect, useMemo, useState } from "react";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { Panel } from "../components/Panel";
import { TrendStatCard } from "../components/TrendStatCard";
import { API_URL } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import type { Job, JobListItem } from "../types/api";

type JobStatusPayload = {
  job_type: "import" | "export";
  job: Job;
};

type JobTypeFilter = "all" | "import" | "export";
type JobStatusFilter = "all" | "queued" | "running" | "succeeded" | "failed";

const REFRESH_INTERVAL_MS = 8000;
const STATS_HISTORY_LIMIT = 12;

type JobStatsSnapshot = {
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
};

function toIsoDateRangeStart(value: string): string {
  return `${value}T00:00:00Z`;
}

function toIsoDateRangeEnd(value: string): string {
  return `${value}T23:59:59Z`;
}

export function JobCenterPage() {
  const { request, accessToken } = useAuth();
  const { showError, showSuccess } = useToast();
  const [rows, setRows] = useState<JobListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [jobType, setJobType] = useState<JobTypeFilter>("all");
  const [jobStatus, setJobStatus] = useState<JobStatusFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statsHistory, setStatsHistory] = useState<JobStatsSnapshot[]>([]);

  const buildSnapshot = (data: JobListItem[]): JobStatsSnapshot => {
    const snapshot: JobStatsSnapshot = {
      total: data.length,
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0
    };
    for (const item of data) {
      if (item.job.status === "queued") snapshot.queued += 1;
      if (item.job.status === "running") snapshot.running += 1;
      if (item.job.status === "succeeded") snapshot.succeeded += 1;
      if (item.job.status === "failed") snapshot.failed += 1;
    }
    return snapshot;
  };

  const appendSnapshot = (data: JobListItem[]) => {
    const snapshot = buildSnapshot(data);
    setStatsHistory((prev) => {
      const next = [...prev, snapshot];
      if (next.length <= STATS_HISTORY_LIMIT) return next;
      return next.slice(next.length - STATS_HISTORY_LIMIT);
    });
  };

  const buildJobsPath = () => {
    const params = new URLSearchParams();
    params.set("limit", "200");
    if (jobType !== "all") params.set("job_type", jobType);
    if (jobStatus !== "all") params.set("status", jobStatus);
    if (dateFrom) params.set("date_from", toIsoDateRangeStart(dateFrom));
    if (dateTo) params.set("date_to", toIsoDateRangeEnd(dateTo));
    return `/jobs?${params.toString()}`;
  };

  const getOutputDocumentId = (item: JobListItem): number | null => {
    if (typeof item.output_document_id === "number") return item.output_document_id;
    const fromPayload = item.job.result_payload?.output_document_id;
    return typeof fromPayload === "number" ? fromPayload : null;
  };

  const loadJobs = async (showToast = false) => {
    setIsLoading(true);
    try {
      const data = await request<JobListItem[]>(buildJobsPath());
      setRows(data);
      appendSnapshot(data);
      setLoadError(null);
      if (showToast) {
        showSuccess("Список задач оновлено");
      }
    } catch (error) {
      const message = (error as Error).message;
      setLoadError(message);
      showError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setStatsHistory([]);
    loadJobs();
  }, [jobType, jobStatus, dateFrom, dateTo]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      loadJobs();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, jobType, jobStatus, dateFrom, dateTo]);

  const refreshOne = async (item: JobListItem) => {
    try {
      const status = await request<JobStatusPayload>(`/jobs/${item.job.id}`);
      setRows((prev) => {
        const nextRows = prev.map((row) =>
          row.job.id === item.job.id
            ? {
                ...row,
                job_type: status.job_type,
                job: status.job
              }
            : row
        );
        appendSnapshot(nextRows);
        return nextRows;
      });
      showSuccess(`Задачу #${item.job.id} оновлено`);
    } catch (error) {
      showError((error as Error).message);
    }
  };

  const downloadExport = async (item: JobListItem) => {
    const outputDocumentId = getOutputDocumentId(item);
    if (!outputDocumentId) {
      showError("Для цієї задачі ще немає файлу для завантаження");
      return;
    }
    if (!accessToken) {
      showError("Потрібна авторизація");
      return;
    }
    try {
      const response = await fetch(`${API_URL}/documents/${outputDocumentId}/download`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!response.ok) {
        throw new Error(`Не вдалося завантажити файл (${response.status})`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const fileNameMatch = disposition.match(/filename=\"?([^\"]+)\"?/i);
      const fileName = fileNameMatch?.[1] || `export_job_${item.job.id}`;

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      showSuccess("Файл експорту завантажено");
    } catch (error) {
      showError((error as Error).message);
    }
  };

  const columns = useMemo<DataTableColumn<JobListItem>[]>(
    () => [
      {
        key: "id",
        header: "ID",
        render: (item) => item.job.id,
        sortAccessor: (item) => item.job.id
      },
      {
        key: "type",
        header: "Тип",
        render: (item) => item.job_type === "import" ? "Імпорт" : "Експорт",
        sortAccessor: (item) => item.job_type
      },
      {
        key: "status",
        header: "Статус",
        render: (item) => item.job.status,
        sortAccessor: (item) => item.job.status
      },
      {
        key: "created_at",
        header: "Створено",
        render: (item) => new Date(item.job.created_at || "").toLocaleString("uk-UA"),
        sortAccessor: (item) => item.job.created_at || ""
      },
      {
        key: "finished_at",
        header: "Завершено",
        render: (item) => (item.job.finished_at ? new Date(item.job.finished_at).toLocaleString("uk-UA") : "—"),
        sortAccessor: (item) => item.job.finished_at || ""
      },
      {
        key: "message",
        header: "Повідомлення",
        render: (item) => item.job.message || "—",
        sortAccessor: (item) => item.job.message || ""
      },
      {
        key: "actions",
        header: "Дії",
        render: (item) => (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded bg-amber px-2 py-1 text-xs font-semibold text-ink"
              onClick={() => refreshOne(item)}
            >
              Оновити
            </button>
            {item.job_type === "export" && item.job.status === "succeeded" && (
              <button
                type="button"
                className="rounded bg-pine px-2 py-1 text-xs font-semibold text-white"
                onClick={() => downloadExport(item)}
              >
                Завантажити
              </button>
            )}
          </div>
        )
      }
    ],
    [accessToken]
  );

  const seriesByKey = useMemo(
    () => ({
      total: statsHistory.map((item) => item.total),
      queued: statsHistory.map((item) => item.queued),
      running: statsHistory.map((item) => item.running),
      succeeded: statsHistory.map((item) => item.succeeded),
      failed: statsHistory.map((item) => item.failed)
    }),
    [statsHistory]
  );

  return (
    <div className="space-y-5">
      <Panel title="Центр задач імпорту/експорту">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Тип задачі</span>
            <select
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              value={jobType}
              onChange={(event) => setJobType(event.target.value as JobTypeFilter)}
            >
              <option value="all">Усі</option>
              <option value="import">Імпорт</option>
              <option value="export">Експорт</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Статус</span>
            <select
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              value={jobStatus}
              onChange={(event) => setJobStatus(event.target.value as JobStatusFilter)}
            >
              <option value="all">Усі</option>
              <option value="queued">queued</option>
              <option value="running">running</option>
              <option value="succeeded">succeeded</option>
              <option value="failed">failed</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Дата від</span>
            <input
              type="date"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Дата до</span>
            <input
              type="date"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </label>
          <div className="flex items-end gap-2">
            <button className="rounded-lg bg-pine px-4 py-2 font-semibold text-white" onClick={() => loadJobs(true)}>
              Оновити
            </button>
            <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
              />
              Автооновлення
            </label>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          {[
            { key: "total", title: "Усього задач", series: seriesByKey.total },
            { key: "queued", title: "У черзі", series: seriesByKey.queued },
            { key: "running", title: "Виконуються", series: seriesByKey.running },
            { key: "succeeded", title: "Успішні", series: seriesByKey.succeeded },
            { key: "failed", title: "Помилки", series: seriesByKey.failed }
          ].map((item) => {
            const current = item.series.length ? item.series[item.series.length - 1] : 0;
            const previous = item.series.length > 1 ? item.series[item.series.length - 2] : null;
            const delta = previous == null ? null : current - previous;
            const valueLabel = isLoading && item.series.length === 0 ? "…" : String(current);
            return (
              <TrendStatCard
                key={item.key}
                title={item.title}
                valueLabel={valueLabel}
                delta={delta}
                series={item.series}
                sparklineLabel={`${item.title}: тренд за останні оновлення`}
              />
            );
          })}
        </div>
      </Panel>

      <Panel title="Історія задач">
        <DataTable
          data={rows}
          columns={columns}
          rowKey={(item) => `${item.job_type}-${item.job.id}`}
          isLoading={isLoading}
          errorText={loadError}
          onRetry={() => loadJobs(true)}
          emptyText="Задачі не знайдено"
          search={{
            placeholder: "Пошук за ID, типом, статусом або повідомленням",
            getSearchText: (item) => `${item.job.id} ${item.job_type} ${item.job.status} ${item.job.message || ""}`
          }}
          initialPageSize={20}
          pageSizeOptions={[10, 20, 50, 100]}
        />
      </Panel>
    </div>
  );
}
