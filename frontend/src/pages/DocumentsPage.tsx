import { FormEvent, useState } from "react";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { API_URL } from "../api/client";
import type { Job } from "../types/api";

type JobStatusPayload = {
  job_type: "import" | "export";
  job: Job;
};

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
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
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
    } catch (error) {
      showError((error as Error).message);
    }
  };

  const runExport = async () => {
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
    } catch (error) {
      showError((error as Error).message);
    }
  };

  const checkJob = async () => {
    if (!activeJobId) return;
    try {
      const response = await request<JobStatusPayload>(`/jobs/${activeJobId}`);
      setActiveJobType(response.job_type);
      setActiveJobStatus(response.job.status);
      setOutputDocumentId(extractOutputDocumentId(response.job));
      showSuccess(response.job.message || "Статус оновлено");
    } catch (error) {
      showError((error as Error).message);
    }
  };

  const downloadOutput = async () => {
    if (!outputDocumentId) {
      showError("Експортований файл ще недоступний");
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
    } catch (error) {
      showError((error as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      <Panel title="Імпорт документів (.xlsx, .pdf, .docx)">
        <form className="flex flex-wrap items-center gap-3" onSubmit={uploadImport}>
          <input
            type="file"
            accept=".xlsx,.pdf,.docx"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            required
          />
          <button className="rounded-lg bg-pine px-4 py-2 font-semibold text-white">Завантажити</button>
        </form>
      </Panel>
      <Panel title="Експорт звітів (.xlsx, .pdf, .csv)">
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="rounded-lg border border-slate-300 px-3 py-2"
            value={reportType}
            onChange={(event) => setReportType(event.target.value)}
          >
            <option value="kpi">KPI</option>
            <option value="trainees">Слухачі</option>
            <option value="teacher_workload">Навантаження викладачів</option>
            <option value="employment">Працевлаштування</option>
            <option value="financial">Фінансовий звіт</option>
            <option value="form_1pa">Форма 1-ПА</option>
          </select>
          <select
            className="rounded-lg border border-slate-300 px-3 py-2"
            value={exportFormat}
            onChange={(event) => setExportFormat(event.target.value)}
          >
            <option value="xlsx">XLSX</option>
            <option value="pdf">PDF</option>
            <option value="csv">CSV</option>
          </select>
          <button className="rounded-lg bg-pine px-4 py-2 font-semibold text-white" onClick={runExport}>
            Згенерувати
          </button>
        </div>
      </Panel>
      <Panel title="Статус job">
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
          <button className="rounded-lg bg-amber px-4 py-2 font-semibold text-ink" onClick={checkJob}>
            Оновити статус
          </button>
          {activeJobType === "export" && outputDocumentId && activeJobStatus === "succeeded" && (
            <button className="rounded-lg bg-pine px-4 py-2 font-semibold text-white" onClick={downloadOutput}>
              Завантажити файл
            </button>
          )}
        </div>
      </Panel>
    </div>
  );
}
