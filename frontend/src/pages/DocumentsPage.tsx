import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { FormField, FormSubmitButton, formControlClass } from "../components/FormField";
import { InlineNotice } from "../components/InlineNotice";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { API_URL } from "../api/client";
import type { Job } from "../types/api";

type JobStatusPayload = {
  job_type: "import" | "export";
  job: Job;
};

type NoticeTone = "info" | "success" | "error";

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
      setNotice({ tone: "error", text: "Оберіть файл для імпорту" });
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    setIsImporting(true);
    try {
      const job = await request<Job>("/documents/import", {
        method: "POST",
        body: formData
      });
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
    setIsExporting(true);
    try {
      const job = await request<Job>("/documents/export", {
        method: "POST",
        body: JSON.stringify({ report_type: reportType, export_format: exportFormat })
      });
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

  return (
    <div className="space-y-5">
      <Panel title="Імпорт документів (.xlsx, .pdf, .docx)">
        <form className="flex flex-wrap items-center gap-3" onSubmit={uploadImport} aria-busy={isImporting}>
          <FormField label="Файл для імпорту" required helperText="Підтримуються .xlsx, .pdf, .docx">
            <input
              type="file"
              className={formControlClass}
              accept=".xlsx,.pdf,.docx"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
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
        <div className="flex flex-wrap items-center gap-3">
          <FormField label="Тип звіту">
            <select
              className={formControlClass}
              value={reportType}
              onChange={(event) => setReportType(event.target.value)}
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
          <FormField label="Формат">
            <select
              className={formControlClass}
              value={exportFormat}
              onChange={(event) => setExportFormat(event.target.value)}
              disabled={isExporting}
            >
              <option value="xlsx">XLSX</option>
              <option value="pdf">PDF</option>
              <option value="csv">CSV</option>
            </select>
          </FormField>
          <button
            type="button"
            className="rounded-lg bg-pine px-4 py-2 font-semibold text-white disabled:opacity-50"
            onClick={runExport}
            disabled={isExporting}
          >
            {isExporting ? "Генеруємо..." : "Згенерувати"}
          </button>
        </div>
      </Panel>
      <Panel title="Статус job">
        {notice && <InlineNotice className="mb-3" tone={notice.tone} text={notice.text} />}
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
      </Panel>
    </div>
  );
}
