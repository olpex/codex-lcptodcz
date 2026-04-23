import { FormEvent, useState } from "react";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import type { Job } from "../types/api";

type JobStatusPayload = {
  job_type: "import" | "export";
  job: Job;
};

export function DocumentsPage() {
  const { request } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [reportType, setReportType] = useState("kpi");
  const [exportFormat, setExportFormat] = useState("xlsx");
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [activeJobType, setActiveJobType] = useState<string | null>(null);
  const [activeJobStatus, setActiveJobStatus] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const uploadImport = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setError("");
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
      setMessage("Імпорт поставлено в чергу");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const runExport = async () => {
    setError("");
    try {
      const job = await request<Job>("/documents/export", {
        method: "POST",
        body: JSON.stringify({ report_type: reportType, export_format: exportFormat })
      });
      setActiveJobId(job.id);
      setActiveJobType("export");
      setActiveJobStatus(job.status);
      setMessage("Експорт поставлено в чергу");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const checkJob = async () => {
    if (!activeJobId) return;
    setError("");
    try {
      const response = await request<JobStatusPayload>(`/jobs/${activeJobId}`);
      setActiveJobType(response.job_type);
      setActiveJobStatus(response.job.status);
      setMessage(response.job.message || "Статус оновлено");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {message && <p className="rounded-lg bg-skyline p-2 text-sm text-pine">{message}</p>}
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
        </div>
      </Panel>
    </div>
  );
}

