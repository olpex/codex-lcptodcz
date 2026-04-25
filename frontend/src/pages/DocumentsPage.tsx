import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FormField, FormSubmitButton, formControlClass } from "../components/FormField";
import { InlineNotice } from "../components/InlineNotice";
import { Panel } from "../components/Panel";
import { StickyActionBar } from "../components/StickyActionBar";
import { TrendStatCard } from "../components/TrendStatCard";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { API_URL } from "../api/client";
import type { Job } from "../types/api";

type JobStatusPayload = {
  job_type: "import" | "export";
  job: Job;
};

type NoticeTone = "info" | "success" | "error";
type KnownJobType = "import" | "export";
type KnownJobStatus = Job["status"];

type KnownJob = {
  jobType: KnownJobType;
  status: KnownJobStatus;
};

type DiagnosticsSnapshot = {
  total: number;
  active: number;
  succeeded: number;
  failed: number;
};

const DIAGNOSTICS_HISTORY_LIMIT = 12;
const ALLOWED_REPORT_TYPES = new Set(["kpi", "trainees", "teacher_workload", "employment", "financial", "form_1pa"]);
const ALLOWED_EXPORT_FORMATS = new Set(["xlsx", "pdf", "csv"]);

export function DocumentsPage() {
  const { request, accessToken } = useAuth();
  const { showError, showSuccess } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [reportType, setReportType] = useState("kpi");
  const [exportFormat, setExportFormat] = useState("xlsx");
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [activeJobType, setActiveJobType] = useState<string | null>(null);
  const [activeJobStatus, setActiveJobStatus] = useState<string | null>(null);
  const [outputDocumentId, setOutputDocumentId] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [importFieldError, setImportFieldError] = useState<string | undefined>(undefined);
  const [exportErrors, setExportErrors] = useState<{ reportType?: string; exportFormat?: string }>({});
  const [, setKnownJobs] = useState<Record<number, KnownJob>>({});
  const [diagnosticsHistory, setDiagnosticsHistory] = useState<DiagnosticsSnapshot[]>([]);

  const buildSnapshot = (registry: Record<number, KnownJob>): DiagnosticsSnapshot => {
    let active = 0;
    let succeeded = 0;
    let failed = 0;
    for (const item of Object.values(registry)) {
      if (item.status === "queued" || item.status === "running") active += 1;
      if (item.status === "succeeded") succeeded += 1;
      if (item.status === "failed") failed += 1;
    }
    return {
      total: Object.keys(registry).length,
      active,
      succeeded,
      failed
    };
  };

  const appendSnapshot = (registry: Record<number, KnownJob>) => {
    const snapshot = buildSnapshot(registry);
    setDiagnosticsHistory((prev) => {
      const next = [...prev, snapshot];
      if (next.length <= DIAGNOSTICS_HISTORY_LIMIT) return next;
      return next.slice(next.length - DIAGNOSTICS_HISTORY_LIMIT);
    });
  };

  const upsertKnownJob = (jobId: number, jobType: KnownJobType, status: KnownJobStatus) => {
    setKnownJobs((prev) => {
      const next = { ...prev, [jobId]: { jobType, status } };
      appendSnapshot(next);
      return next;
    });
  };

  const extractOutputDocumentId = (job: Job): number | null => {
    if (!job.result_payload || typeof job.result_payload !== "object") {
      return null;
    }
    const value = (job.result_payload as Record<string, unknown>).output_document_id;
    return typeof value === "number" ? value : null;
  };

  const uploadImport = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) {
      showError("Оберіть файл для імпорту");
      setImportFieldError("Оберіть файл для імпорту");
      setNotice({ tone: "error", text: "Оберіть файл для імпорту" });
      return;
    }
    setImportFieldError(undefined);

    const formData = new FormData();
    formData.append("file", file);
    setIsImporting(true);
    try {
      const job = await request<Job>("/documents/import", {
        method: "POST",
        body: formData
      });
      upsertKnownJob(job.id, "import", job.status);
      setActiveJobId(job.id);
      setActiveJobType("import");
      setActiveJobStatus(job.status);
      setOutputDocumentId(null);
      showSuccess(job.message || "Імпорт запущено");
      setNotice({ tone: "success", text: job.message || "Імпорт запущено. Перевірте статус задачі нижче." });
    } catch (error) {
      const message = (error as Error).message;
      showError(message);
      setNotice({ tone: "error", text: message });
    } finally {
      setIsImporting(false);
    }
  };

  const runExport = async () => {
    const nextErrors: { reportType?: string; exportFormat?: string } = {};
    if (!ALLOWED_REPORT_TYPES.has(reportType)) {
      nextErrors.reportType = "Оберіть валідний тип звіту";
    }
    if (!ALLOWED_EXPORT_FORMATS.has(exportFormat)) {
      nextErrors.exportFormat = "Оберіть валідний формат експорту";
    }
    if (Object.keys(nextErrors).length) {
      setExportErrors(nextErrors);
      showError(Object.values(nextErrors)[0]);
      return;
    }
    setExportErrors({});

    setIsExporting(true);
    try {
      const job = await request<Job>("/documents/export", {
        method: "POST",
        body: JSON.stringify({ report_type: reportType, export_format: exportFormat })
      });
      upsertKnownJob(job.id, "export", job.status);
      setActiveJobId(job.id);
      setActiveJobType("export");
      setActiveJobStatus(job.status);
      setOutputDocumentId(extractOutputDocumentId(job));
      showSuccess(job.message || "Експорт запущено");
      setNotice({ tone: "success", text: job.message || "Експорт запущено. Перевірте статус задачі нижче." });
    } catch (error) {
      const message = (error as Error).message;
      showError(message);
      setNotice({ tone: "error", text: message });
    } finally {
      setIsExporting(false);
    }
  };

  const checkJob = async () => {
    if (!activeJobId) return;
    setIsCheckingStatus(true);
    try {
      const response = await request<JobStatusPayload>(`/jobs/${activeJobId}`);
      upsertKnownJob(response.job.id, response.job_type, response.job.status);
      setActiveJobType(response.job_type);
      setActiveJobStatus(response.job.status);
      setOutputDocumentId(extractOutputDocumentId(response.job));
      showSuccess(response.job.message || "Статус оновлено");
      setNotice({ tone: "info", text: response.job.message || "Статус задачі оновлено" });
    } catch (error) {
      const message = (error as Error).message;
      showError(message);
      setNotice({ tone: "error", text: message });
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const downloadOutput = async () => {
    if (!outputDocumentId) {
      showError("Експортований файл ще недоступний");
      setNotice({ tone: "error", text: "Експортований файл ще недоступний" });
      return;
    }
    if (!accessToken) {
      showError("Потрібна авторизація");
      setNotice({ tone: "error", text: "Потрібна авторизація" });
      return;
    }
    setIsDownloading(true);
    try {
      const response = await fetch(`${API_URL}/documents/${outputDocumentId}/download`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!response.ok) {
        throw new Error(`Не вдалося завантажити файл (${response.status})`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const fileNameMatch = disposition.match(/filename="?([^"]+)"?/i);
      const fileName = fileNameMatch?.[1] || `report_${outputDocumentId}`;

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      showSuccess("Файл завантажено");
      setNotice({ tone: "success", text: "Файл експорту успішно завантажено" });
    } catch (error) {
      const message = (error as Error).message;
      showError(message);
      setNotice({ tone: "error", text: message });
    } finally {
      setIsDownloading(false);
    }
  };

  const seriesByKey = useMemo(
    () => ({
      total: diagnosticsHistory.map((item) => item.total),
      active: diagnosticsHistory.map((item) => item.active),
      succeeded: diagnosticsHistory.map((item) => item.succeeded),
      failed: diagnosticsHistory.map((item) => item.failed)
    }),
    [diagnosticsHistory]
  );

  return (
    <div className="space-y-5">
      <Panel title="Імпорт документів (.xls, .xlsx, .pdf, .docx, .csv)">
        <form className="flex flex-wrap items-center gap-3" onSubmit={uploadImport} aria-busy={isImporting}>
          <FormField
            label="Файл для імпорту"
            required
            helperText="Підтримуються .xls/.xlsx, .pdf, .docx, .csv"
            errorText={importFieldError}
          >
            <input
              type="file"
              className={formControlClass}
              accept=".xls,.xlsx,.pdf,.docx,.csv"
              onChange={(event) => {
                setFile(event.target.files?.[0] || null);
                setImportFieldError(undefined);
              }}
              disabled={isImporting}
              required
            />
          </FormField>
          <FormSubmitButton
            isLoading={isImporting}
            idleLabel="Завантажити"
            loadingLabel="Завантаження..."
            className="rounded-lg bg-pine px-4 py-2 font-semibold text-white"
          />
        </form>
      </Panel>
      <Panel title="Експорт звітів (.xlsx, .pdf, .csv)">
        <StickyActionBar>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              runExport();
            }}
          >
            <FormField
              label="Тип звіту"
              helperText="Оберіть набір даних для експорту"
              errorText={exportErrors.reportType}
            >
              <select
                className={formControlClass}
                value={reportType}
                onChange={(event) => {
                  setReportType(event.target.value);
                  setExportErrors((prev) => ({ ...prev, reportType: undefined }));
                }}
                disabled={isExporting}
              >
                <option value="kpi">KPI</option>
                <option value="trainees">Слухачі</option>
                <option value="teacher_workload">Навантаження викладачів</option>
                <option value="employment">Працевлаштування</option>
                <option value="financial">Фінансовий звіт</option>
                <option value="form_1pa">Форма 1-ПА</option>
              </select>
            </FormField>
            <FormField label="Формат" helperText="XLSX/PDF/CSV" errorText={exportErrors.exportFormat}>
              <select
                className={formControlClass}
                value={exportFormat}
                onChange={(event) => {
                  setExportFormat(event.target.value);
                  setExportErrors((prev) => ({ ...prev, exportFormat: undefined }));
                }}
                disabled={isExporting}
              >
                <option value="xlsx">XLSX</option>
                <option value="pdf">PDF</option>
                <option value="csv">CSV</option>
              </select>
            </FormField>
            <FormSubmitButton
              isLoading={isExporting}
              idleLabel="Згенерувати"
              loadingLabel="Генеруємо..."
              className="rounded-lg bg-pine px-4 py-2 font-semibold text-white"
            />
          </form>
        </StickyActionBar>
      </Panel>
      <Panel title="Статус job">
        {notice && <InlineNotice className="mb-3" tone={notice.tone} text={notice.text} />}
        <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            { key: "total", title: "Усього задач", series: seriesByKey.total },
            { key: "active", title: "Активні задачі", series: seriesByKey.active },
            { key: "succeeded", title: "Успішні задачі", series: seriesByKey.succeeded },
            { key: "failed", title: "Помилки задач", series: seriesByKey.failed }
          ].map((item) => {
            const current = item.series.length ? item.series[item.series.length - 1] : 0;
            const previous = item.series.length > 1 ? item.series[item.series.length - 2] : null;
            const delta = previous == null ? null : current - previous;
            return (
              <TrendStatCard
                key={item.key}
                title={item.title}
                valueLabel={String(current)}
                delta={delta}
                series={item.series}
                sparklineLabel={`${item.title}: тренд за останні оновлення`}
              />
            );
          })}
        </div>
        <StickyActionBar>
          <div className="flex flex-wrap items-center gap-3">
            <p>
              ID: <span className="font-semibold">{activeJobId ?? "—"}</span>
            </p>
            <p>
              Тип: <span className="font-semibold">{activeJobType ?? "—"}</span>
            </p>
            <p>
              Статус: <span className="font-semibold">{activeJobStatus ?? "—"}</span>
            </p>
            <button
              type="button"
              className="rounded-lg bg-amber px-4 py-2 font-semibold text-ink disabled:opacity-50"
              onClick={checkJob}
              disabled={!activeJobId || isCheckingStatus}
            >
              {isCheckingStatus ? "Оновлюємо..." : "Оновити статус"}
            </button>
            {activeJobType === "export" && outputDocumentId && activeJobStatus === "succeeded" && (
              <button
                type="button"
                className="rounded-lg bg-pine px-4 py-2 font-semibold text-white disabled:opacity-50"
                onClick={downloadOutput}
                disabled={isDownloading}
              >
                {isDownloading ? "Завантажуємо..." : "Завантажити файл"}
              </button>
            )}
            <Link className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700" to="/jobs">
              Відкрити центр задач
            </Link>
          </div>
        </StickyActionBar>
      </Panel>
    </div>
  );
}
