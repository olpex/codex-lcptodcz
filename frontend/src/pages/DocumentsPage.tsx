import { Link } from "react-router-dom";
import { FormField, FormSubmitButton, formControlClass } from "../components/FormField";
import { InlineNotice } from "../components/InlineNotice";
import { Panel } from "../components/Panel";
import { StickyActionBar } from "../components/StickyActionBar";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { API_URL } from "../api/client";
import { formatJobStatus, formatJobType } from "../i18n/statuses";
import { usePageRefresh } from "../hooks/usePageRefresh";
import type { Job } from "../types/api";
import { useState } from "react";

type JobStatusPayload = {
  job_type: "import" | "export";
  job: Job;
};

type NoticeTone = "info" | "success" | "error";

const ALLOWED_REPORT_TYPES = new Set(["kpi", "trainees", "groups", "teacher_workload", "employment", "financial", "form_1pa"]);
const ALLOWED_EXPORT_FORMATS = new Set(["xlsx", "pdf", "csv"]);

export function DocumentsPage() {
  const { request, accessToken } = useAuth();
  const { showError, showSuccess } = useToast();
  const [reportType, setReportType] = useState("kpi");
  const [exportFormat, setExportFormat] = useState("xlsx");
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [activeJobType, setActiveJobType] = useState<string | null>(null);
  const [activeJobStatus, setActiveJobStatus] = useState<string | null>(null);
  const [outputDocumentId, setOutputDocumentId] = useState<number | null>(null);
  const [downloadedDocumentIds, setDownloadedDocumentIds] = useState<number[]>([]);
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [exportErrors, setExportErrors] = useState<{ reportType?: string; exportFormat?: string }>({});

  const extractOutputDocumentId = (job: Job): number | null => {
    if (!job.result_payload || typeof job.result_payload !== "object") {
      return null;
    }
    const value = (job.result_payload as Record<string, unknown>).output_document_id;
    return typeof value === "number" ? value : null;
  };

  const downloadDocument = async (documentId: number) => {
    if (!accessToken) {
      throw new Error("Потрібна авторизація");
    }
    const response = await fetch(`${API_URL}/documents/${documentId}/download`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      throw new Error(`Не вдалося завантажити файл (${response.status})`);
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const fileNameMatch = disposition.match(/filename="?([^"]+)"?/i);
    const fileName = fileNameMatch?.[1] || `report_${documentId}`;

    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
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
      setActiveJobId(job.id);
      setActiveJobType("export");
      setActiveJobStatus(job.status);
      const exportedDocumentId = extractOutputDocumentId(job);
      setOutputDocumentId(exportedDocumentId);
      if (job.status === "succeeded" && exportedDocumentId) {
        await downloadDocument(exportedDocumentId);
        setDownloadedDocumentIds((prev) => (prev.includes(exportedDocumentId) ? prev : [...prev, exportedDocumentId]));
        showSuccess("Звіт сформовано і завантажено");
        setNotice({ tone: "success", text: "Звіт сформовано і завантажено. Файл доступний у завантаженнях браузера." });
      } else {
        showSuccess(job.message || "Експорт запущено");
        setNotice({ tone: "success", text: job.message || "Експорт запущено. Перевірте статус експорту нижче." });
      }
    } catch (error) {
      const message = (error as Error).message;
      showError(message);
      setNotice({ tone: "error", text: message });
    } finally {
      setIsExporting(false);
    }
  };

  const checkJob = async (showToastMessage = true) => {
    if (!activeJobId) return;
    setIsCheckingStatus(true);
    try {
      const response = await request<JobStatusPayload>(`/jobs/${activeJobId}`);
      setActiveJobType(response.job_type);
      setActiveJobStatus(response.job.status);
      const exportedDocumentId = extractOutputDocumentId(response.job);
      setOutputDocumentId(exportedDocumentId);
      if (showToastMessage) {
        showSuccess(response.job.message || "Статус оновлено");
      }
      if (response.job_type === "export" && response.job.status === "succeeded" && exportedDocumentId) {
        if (!downloadedDocumentIds.includes(exportedDocumentId)) {
          await downloadDocument(exportedDocumentId);
          setDownloadedDocumentIds((prev) => (prev.includes(exportedDocumentId) ? prev : [...prev, exportedDocumentId]));
          showSuccess("Звіт сформовано і завантажено");
          setNotice({ tone: "success", text: "Експорт виконано. Файл завантажено у завантаження браузера." });
        } else {
          setNotice({ tone: "success", text: "Експорт виконано. Натисніть «Завантажити файл», якщо потрібна ще одна копія." });
        }
      } else {
        setNotice({ tone: "info", text: response.job.message || "Статус задачі оновлено" });
      }
    } catch (error) {
      const message = (error as Error).message;
      showError(message);
      setNotice({ tone: "error", text: message });
    } finally {
      setIsCheckingStatus(false);
    }
  };

  usePageRefresh(() => checkJob(false), {
    enabled: Boolean(activeJobId),
    intervalMs: activeJobStatus === "queued" || activeJobStatus === "running" ? 10_000 : 0,
    refreshOnFocus: false
  });

  const downloadOutput = async () => {
    if (!outputDocumentId) {
      showError("Експортований файл ще недоступний");
      setNotice({ tone: "error", text: "Експортований файл ще недоступний" });
      return;
    }
    setIsDownloading(true);
    try {
      await downloadDocument(outputDocumentId);
      setDownloadedDocumentIds((prev) => (prev.includes(outputDocumentId) ? prev : [...prev, outputDocumentId]));
      showSuccess("Файл завантажено");
      setNotice({ tone: "success", text: "Файл експорту завантажено. Шукайте його у завантаженнях браузера." });
    } catch (error) {
      const message = (error as Error).message;
      showError(message);
      setNotice({ tone: "error", text: message });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-5">
      <Panel title="Імпорт даних">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-2xl text-sm leading-6 text-slate-700">
            <p>
              Завантаження договорів, списків слухачів і розкладів виконується у центрі імпорту. Там можна спочатку
              перевірити файл, обрати режим оновлення і побачити історію задач.
            </p>
            <p className="mt-2 font-semibold text-ink">Автоматичний імпорт: XLS/XLSX/CSV для слухачів, DOCX для розкладу.</p>
          </div>
          <Link className="rounded-lg bg-pine px-4 py-2 text-sm font-semibold text-white" to="/jobs">
            Відкрити центр імпорту
          </Link>
        </div>
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
                <option value="groups">Групи</option>
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

      {(notice || activeJobId) && (
        <Panel title="Статус експорту">
          {notice && <InlineNotice className="mb-3" tone={notice.tone} text={notice.text} />}
          <StickyActionBar>
            <div className="flex flex-wrap items-center gap-3">
              <p>
                ID: <span className="font-semibold">{activeJobId ?? "—"}</span>
              </p>
              <p>
                Тип: <span className="font-semibold">{formatJobType(activeJobType)}</span>
              </p>
              <p>
                Статус: <span className="font-semibold">{formatJobStatus(activeJobStatus)}</span>
              </p>
              <button
                type="button"
                className="rounded-lg bg-amber px-4 py-2 font-semibold text-ink disabled:opacity-50"
                onClick={() => checkJob(true)}
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
      )}
    </div>
  );
}
