import { useEffect, useMemo, useState } from "react";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { FormField, formControlClass } from "../components/FormField";
import { InlineNotice } from "../components/InlineNotice";
import { Panel } from "../components/Panel";
import { StickyActionBar } from "../components/StickyActionBar";
import { TrendStatCard } from "../components/TrendStatCard";
import { API_URL } from "../api/client";
import { formatImportSource, formatJobStatus, formatJobType } from "../i18n/statuses";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { usePageRefresh } from "../hooks/usePageRefresh";
import type { ImportPreview, Job, JobListItem } from "../types/api";

type JobStatusPayload = {
  job_type: "import" | "export";
  job: Job;
};

type JobTypeFilter = "all" | "import" | "export";
type JobStatusFilter = "all" | "queued" | "running" | "succeeded" | "failed";
type ImportMode = "skip_existing" | "missing_only" | "overwrite";

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

function formatDuplicateMatchReason(reason: string | null): string {
  if (reason === "contract_number") return "№ договору";
  if (reason === "name_birth_date") return "ПІБ і дата";
  if (reason === "partial_name_birth_date") return "Частковий ПІБ";
  return "—";
}

export function JobCenterPage() {
  const { request, accessToken } = useAuth();
  const { showError, showSuccess } = useToast();
  const [rows, setRows] = useState<JobListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [jobType, setJobType] = useState<JobTypeFilter>("import");
  const [jobStatus, setJobStatus] = useState<JobStatusFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statsHistory, setStatsHistory] = useState<JobStatsSnapshot[]>([]);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("skip_existing");
  const [isImporting, setIsImporting] = useState(false);
  const [isPreviewingImport, setIsPreviewingImport] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importNotice, setImportNotice] = useState<{ tone: "info" | "success" | "error"; text: string } | null>(null);

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

  const describeImportResult = (item: JobListItem): string => {
    if (item.job_type !== "import") return "—";
    const result = item.job.result_payload?.import_result;
    if (!result || typeof result !== "object") return item.job.message || "—";

    const data = result as Record<string, unknown>;
    if (data.import_kind === "schedule_docx") {
      const created = Number(data.created_slots || 0);
      const deleted = Number(data.deleted_slots || 0);
      const teachers = Number(data.teachers || 0);
      const subjects = Number(data.subjects || 0);
      return `Розклад: створено занять ${created}, замінено ${deleted}, викладачів ${teachers}, предметів ${subjects}`;
    }

    const inserted = Number(data.inserted || 0);
    const updated = Number(data.updated_existing || 0);
    const skippedExisting = Number(data.skipped_existing || 0);
    const skippedInvalid = Number(data.skipped_invalid || 0);
    const memberships = Number(data.memberships_created || 0);
    if (data.note && inserted === 0 && updated === 0) return String(data.note);
    return `Слухачі: додано ${inserted}, оновлено ${updated}, прив'язок ${memberships}, пропущено ${skippedExisting + skippedInvalid}`;
  };

  const previewImport = async () => {
    if (!importFile) {
      const message = "Оберіть файл для перевірки";
      setImportNotice({ tone: "error", text: message });
      showError(message);
      return;
    }
    const formData = new FormData();
    formData.append("file", importFile);
    setIsPreviewingImport(true);
    try {
      const preview = await request<ImportPreview>("/documents/import/preview", {
        method: "POST",
        body: formData
      });
      setImportPreview(preview);
      const message =
        preview.import_kind === "schedule"
          ? `Перевірено: груп ${preview.groups.length}, занять ${preview.rows}`
          : `Перевірено: нових ${preview.new_count}, дублікатів ${preview.duplicate_count}`;
      setImportNotice({ tone: preview.warnings.length ? "info" : "success", text: message });
      showSuccess(message);
    } catch (error) {
      const message = (error as Error).message;
      setImportPreview(null);
      setImportNotice({ tone: "error", text: message });
      showError(message);
    } finally {
      setIsPreviewingImport(false);
    }
  };

  const uploadImport = async () => {
    if (!importFile) {
      const message = "Оберіть XLSX/CSV договір або DOCX розклад";
      setImportNotice({ tone: "error", text: message });
      showError(message);
      return;
    }
    const formData = new FormData();
    formData.append("file", importFile);
    formData.append("update_existing_mode", importMode);
    setIsImporting(true);
    try {
      const job = await request<Job>("/documents/import", {
        method: "POST",
        body: formData
      });
      setJobType("import");
      setJobStatus("all");
      setImportPreview(null);
      setImportNotice({ tone: "success", text: job.message || `Імпорт #${job.id} створено` });
      showSuccess(job.message || `Імпорт #${job.id} створено`);
      const data = await request<JobListItem[]>("/jobs?limit=200&job_type=import");
      setRows(data);
      appendSnapshot(data);
      setLoadError(null);
    } catch (error) {
      const message = (error as Error).message;
      setImportNotice({ tone: "error", text: message });
      showError(message);
    } finally {
      setIsImporting(false);
    }
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

  usePageRefresh(() => loadJobs(), { intervalMs: 0, refreshOnFocus: false });

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

  const updateRowFromStatus = (itemId: number, payload: JobStatusPayload) => {
    setRows((prev) => {
      const nextRows = prev.map((row) =>
        row.job.id === itemId
          ? {
              ...row,
              job_type: payload.job_type,
              job: payload.job
            }
          : row
      );
      appendSnapshot(nextRows);
      return nextRows;
    });
  };

  const cancelJob = async (item: JobListItem) => {
    try {
      const payload = await request<JobStatusPayload>(`/jobs/${item.job.id}/cancel`, { method: "POST" });
      updateRowFromStatus(item.job.id, payload);
      showSuccess(`Задачу #${item.job.id} скасовано`);
    } catch (error) {
      showError((error as Error).message);
    }
  };

  const retryJob = async (item: JobListItem) => {
    try {
      const payload = await request<JobStatusPayload>(`/jobs/${item.job.id}/retry`, { method: "POST" });
      updateRowFromStatus(item.job.id, payload);
      showSuccess(`Задачу #${item.job.id} перезапущено`);
    } catch (error) {
      showError((error as Error).message);
    }
  };

  const reprocessImportJob = async (item: JobListItem) => {
    if (item.job_type !== "import" || !item.document_id) {
      showError("Для цієї задачі немає документа для повторного імпорту");
      return;
    }
    try {
      const payload = await request<JobStatusPayload>(`/jobs/${item.job.id}/reprocess-import`, { method: "POST" });
      setJobType("import");
      setJobStatus("all");
      const data = await request<JobListItem[]>("/jobs?limit=200&job_type=import");
      setRows(data);
      appendSnapshot(data);
      showSuccess(`Створено повторний імпорт #${payload.job.id}`);
    } catch (error) {
      showError((error as Error).message);
    }
  };

  const rollbackImportJob = async (item: JobListItem) => {
    try {
      const payload = await request<JobStatusPayload>(`/jobs/${item.job.id}/rollback-import`, { method: "POST" });
      updateRowFromStatus(item.job.id, payload);
      showSuccess(`Імпорт #${item.job.id} відкликано`);
    } catch (error) {
      showError((error as Error).message);
    }
  };

  const hasRollbackData = (item: JobListItem) => {
    const inserted = item.job.result_payload?.import_result as Record<string, unknown> | undefined;
    return Array.isArray(inserted?.inserted_ids) && inserted.inserted_ids.length > 0;
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
        render: (item) => formatJobType(item.job_type),
        sortAccessor: (item) => formatJobType(item.job_type)
      },
      {
        key: "source",
        header: "Джерело",
        render: (item) => (item.job_type === "import" ? formatImportSource(item.import_source) : "—"),
        sortAccessor: (item) => (item.job_type === "import" ? formatImportSource(item.import_source) : "")
      },
      {
        key: "status",
        header: "Статус",
        render: (item) => formatJobStatus(item.job.status),
        sortAccessor: (item) => formatJobStatus(item.job.status)
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
        key: "result",
        header: "Результат",
        render: (item) => describeImportResult(item),
        sortAccessor: (item) => describeImportResult(item)
      },
      {
        key: "document",
        header: "Документ/звіт",
        render: (item) => {
          if (item.job_type === "import") {
            return item.document_file_name || "—";
          }
          return item.output_file_name || item.report_type || "—";
        },
        sortAccessor: (item) => `${item.document_file_name || ""} ${item.output_file_name || ""} ${item.report_type || ""}`
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
            {(item.job.status === "queued" || item.job.status === "running") && (
              <button
                type="button"
                className="rounded bg-red-100 px-2 py-1 text-xs font-semibold text-red-700"
                onClick={() => cancelJob(item)}
              >
                Скасувати
              </button>
            )}
            {item.job.status === "failed" && (
              <button
                type="button"
                className="rounded bg-indigo-100 px-2 py-1 text-xs font-semibold text-indigo-700"
                onClick={() => retryJob(item)}
              >
                Повторити
              </button>
            )}
            {item.job_type === "import" && item.document_id && (
              <button
                type="button"
                className="rounded bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-700"
                onClick={() => reprocessImportJob(item)}
              >
                2.2 Повторно імпортувати
              </button>
            )}
            {item.job_type === "import" && item.job.status === "succeeded" && hasRollbackData(item) && (
              <button
                type="button"
                className="rounded bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-700"
                onClick={() => rollbackImportJob(item)}
              >
                Відкликати імпорт
              </button>
            )}
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
      <Panel title="1.1 Центр імпорту">
        <div className="mb-4 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_auto_auto]">
          <FormField label="Файл" helperText="Договір XLS/XLSX/CSV або розклад DOCX">
            <input
              type="file"
              className={formControlClass}
              accept=".xls,.xlsx,.csv,.docx"
              onChange={(event) => {
                setImportFile(event.target.files?.[0] || null);
                setImportPreview(null);
              }}
              disabled={isImporting || isPreviewingImport}
            />
          </FormField>
          <FormField label="Режим імпорту" helperText="Як обробляти наявних слухачів або розклад">
            <select
              className={formControlClass}
              value={importMode}
              onChange={(event) => setImportMode(event.target.value as ImportMode)}
              disabled={isImporting || isPreviewingImport}
            >
              <option value="skip_existing">Пропустити наявні</option>
              <option value="missing_only">Додати/дозаповнити відсутнє</option>
              <option value="overwrite">Замінити/оновити існуюче</option>
            </select>
          </FormField>
          <div className="flex items-end">
            <button
              type="button"
              className="w-full rounded-lg border border-pine px-4 py-2 font-semibold text-pine disabled:opacity-50"
              onClick={previewImport}
              disabled={isImporting || isPreviewingImport}
            >
              {isPreviewingImport ? "Перевіряємо..." : "2.3 Перевірити"}
            </button>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              className="w-full rounded-lg bg-pine px-4 py-2 font-semibold text-white disabled:opacity-50"
              onClick={uploadImport}
              disabled={isImporting || isPreviewingImport}
            >
              {isImporting ? "Завантажуємо..." : "2.1 Завантажити файл"}
            </button>
          </div>
        </div>
        {importNotice && <InlineNotice className="mb-4" tone={importNotice.tone} text={importNotice.text} />}
        {importPreview && (
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
              <span className="font-semibold text-ink">{importPreview.filename}</span>
              <span className="rounded bg-white px-2 py-1 text-xs font-semibold uppercase text-slate-600">
                {importPreview.import_kind === "schedule" ? "Розклад" : "Договори"}
              </span>
              <span className="text-slate-600">Рядків/занять: {importPreview.rows}</span>
              {importPreview.sheet_name && <span className="text-slate-600">Аркуш: {importPreview.sheet_name}</span>}
              {importPreview.default_group_code && (
                <span className="text-slate-600">Група: {importPreview.default_group_code}</span>
              )}
              {importPreview.import_kind === "contracts" && (
                <>
                  <span className="text-slate-600">Нових: {importPreview.new_count}</span>
                  <span className="text-slate-600">Дублікатів: {importPreview.duplicate_count}</span>
                  <span className="text-slate-600">Некоректних: {importPreview.invalid_count}</span>
                </>
              )}
            </div>
            {importPreview.warnings.length > 0 && (
              <div className="mb-3 space-y-1 text-sm text-amber-800">
                {importPreview.warnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>
            )}
            {importPreview.groups.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-2 py-2">Група</th>
                      <th className="px-2 py-2">Період</th>
                      <th className="px-2 py-2">Занять</th>
                      <th className="px-2 py-2">Викладачів</th>
                      <th className="px-2 py-2">Предметів</th>
                      <th className="px-2 py-2">Годин</th>
                      <th className="px-2 py-2">Уже є занять</th>
                      <th className="px-2 py-2">Є в базі</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.groups.map((group) => (
                      <tr key={`${group.code}-${group.name}`} className="border-t border-slate-200">
                        <td className="px-2 py-2 font-semibold text-ink">
                          {group.code} {group.name}
                        </td>
                        <td className="px-2 py-2 text-slate-700">
                          {group.start_date || "?"} - {group.end_date || "?"}
                        </td>
                        <td className="px-2 py-2">{group.lessons}</td>
                        <td className="px-2 py-2">{group.teachers}</td>
                        <td className="px-2 py-2">{group.subjects}</td>
                        <td className="px-2 py-2">{group.total_hours}</td>
                        <td className="px-2 py-2">{group.existing_lessons}</td>
                        <td className="px-2 py-2">{group.already_exists ? "Так" : "Ні"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {importPreview.duplicate_preview.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <div className="mb-2 text-sm font-semibold text-ink">Знайдені дублікати</div>
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-2 py-2">Рядок</th>
                      <th className="px-2 py-2">У файлі</th>
                      <th className="px-2 py-2">У базі</th>
                      <th className="px-2 py-2">Договір</th>
                      <th className="px-2 py-2">Група</th>
                      <th className="px-2 py-2">Збіг</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.duplicate_preview.map((item) => (
                      <tr key={`${item.row_number}-${item.existing_id}`} className="border-t border-slate-200">
                        <td className="px-2 py-2">{item.row_number || "?"}</td>
                        <td className="px-2 py-2 font-semibold text-ink">{item.incoming_name}</td>
                        <td className="px-2 py-2 text-slate-700">
                          #{item.existing_id} {item.existing_name}
                        </td>
                        <td className="px-2 py-2">{item.contract_number || "—"}</td>
                        <td className="px-2 py-2">{item.group_code || "—"}</td>
                        <td className="px-2 py-2">{formatDuplicateMatchReason(item.match_reason)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {importPreview.preview.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      {(importPreview.headers.length ? importPreview.headers : Object.keys(importPreview.preview[0])).map((header) => (
                        <th key={header} className="px-2 py-2">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.preview.map((row, index) => (
                      <tr key={index} className="border-t border-slate-200">
                        {(importPreview.headers.length ? importPreview.headers : Object.keys(row)).map((header) => (
                          <td key={header} className="max-w-64 truncate px-2 py-2 text-slate-700">
                            {row[header] || ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        <StickyActionBar className="mb-4">
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
              <option value="queued">{formatJobStatus("queued")}</option>
              <option value="running">{formatJobStatus("running")}</option>
              <option value="succeeded">{formatJobStatus("succeeded")}</option>
              <option value="failed">{formatJobStatus("failed")}</option>
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
        </StickyActionBar>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
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

      <Panel title="1.1 Історія імпортів та задач">
        <DataTable
          data={rows}
          columns={columns}
          rowKey={(item) => `${item.job_type}-${item.job.id}`}
          isLoading={isLoading}
          errorText={loadError}
          onRetry={() => loadJobs(true)}
          emptyText="Задачі не знайдено"
          emptyActionLabel="Оновити задачі"
          onEmptyAction={() => loadJobs(true)}
          emptyActionDisabled={isLoading}
          search={{
            placeholder: "Пошук за ID, типом, статусом, результатом або назвою документа",
            getSearchText: (item) =>
              `${item.job.id} ${item.job_type} ${formatJobType(item.job_type)} ${item.import_source || ""} ${formatImportSource(item.import_source)} ${item.job.status} ${formatJobStatus(item.job.status)} ${item.job.message || ""} ${describeImportResult(item)} ${item.document_file_name || ""} ${item.output_file_name || ""} ${item.report_type || ""}`
          }}
          initialPageSize={20}
          pageSizeOptions={[10, 20, 50, 100]}
        />
      </Panel>
    </div>
  );
}
