import clsx from "clsx";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { API_URL } from "../api/client";
import { InlineNotice } from "../components/InlineNotice";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { usePageRefresh } from "../hooks/usePageRefresh";
import type { JournalMonitorEntry, JournalMonitorSection } from "../types/api";

const EXPORT_FORMATS = ["xlsx", "pdf", "docx", "csv"] as const;

const STATUS_LABELS: Record<string, string> = {
  complete: "Розклад і слухачі",
  schedule_only: "Тільки розклад",
  trainees_only: "Тільки слухачі",
  not_processed: "Не опрацьовано",
  unknown_code: "Без номера групи"
};

const STATUS_CLASSES: Record<string, string> = {
  complete: "bg-emerald-100 text-emerald-800",
  schedule_only: "bg-sky-100 text-sky-800",
  trainees_only: "bg-amber-100 text-amber-800",
  not_processed: "bg-rose-100 text-rose-800",
  unknown_code: "bg-slate-100 text-slate-700"
};

function formatDateTime(value: string | null): string {
  if (!value) return "Ще не оновлювався";
  return new Date(value).toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatStatus(value: string): string {
  return STATUS_LABELS[value] || value;
}

function getFileName(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition") || "";
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch) return decodeURIComponent(utfMatch[1]);
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] || fallback;
}

export function JournalMonitorsPage() {
  const { request, accessToken } = useAuth();
  const { showError, showSuccess, showInfo } = useToast();
  const [sections, setSections] = useState<JournalMonitorSection[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<JournalMonitorSection | null>(null);
  const [name, setName] = useState(`Журнали ${new Date().getFullYear()}`);
  const [folderUrl, setFolderUrl] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const selectedSection = useMemo(
    () => sections.find((section) => section.id === selectedId) || null,
    [sections, selectedId]
  );
  const rows = detail?.entries || [];

  const loadSections = async () => {
    const data = await request<JournalMonitorSection[]>("/journal-monitors");
    setSections(data);
    if (data.length > 0 && !selectedId) {
      setSelectedId(data[0].id);
    }
    if (data.length === 0) {
      setDetail(null);
    }
    return data;
  };

  const loadDetail = async (sectionId: number) => {
    const data = await request<JournalMonitorSection>(`/journal-monitors/${sectionId}`);
    setDetail(data);
    return data;
  };

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await loadSections();
      const nextSelectedId = selectedId || data[0]?.id || null;
      if (nextSelectedId) {
        await loadDetail(nextSelectedId);
      }
      setErrorText(null);
    } catch (error) {
      const message = (error as Error).message;
      setErrorText(message);
      showError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const syncSelected = async (showToast = true) => {
    const sectionId = selectedId || selectedSection?.id;
    if (!sectionId) return;
    setIsSyncing(true);
    try {
      const data = await request<JournalMonitorSection>(`/journal-monitors/${sectionId}/sync`, { method: "POST" });
      setDetail(data);
      await loadSections();
      setErrorText(null);
      if (showToast) showSuccess("Моніторинг журналів оновлено");
    } catch (error) {
      const message = (error as Error).message;
      setErrorText(message);
      if (showToast) showError(message);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    loadDetail(selectedId).catch((error) => {
      const message = (error as Error).message;
      setErrorText(message);
      showError(message);
    });
  }, [selectedId]);

  usePageRefresh(() => syncSelected(false), { enabled: Boolean(selectedId), intervalMs: 60_000 });

  const createSection = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      const section = await request<JournalMonitorSection>("/journal-monitors", {
        method: "POST",
        body: JSON.stringify({ name, folder_url: folderUrl })
      });
      setSelectedId(section.id);
      setFolderUrl("");
      await loadSections();
      showInfo("Розділ створено. Запускаю першу синхронізацію.");
      await request<JournalMonitorSection>(`/journal-monitors/${section.id}/sync`, { method: "POST" })
        .then((data) => {
          setDetail(data);
          showSuccess("Першу синхронізацію завершено");
        })
        .catch((error) => {
          const message = (error as Error).message;
          setErrorText(message);
          showError(message);
        });
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const exportSection = async (format: (typeof EXPORT_FORMATS)[number]) => {
    if (!selectedId || !accessToken) return;
    try {
      const response = await fetch(`${API_URL}/journal-monitors/${selectedId}/export?format=${format}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || `Не вдалося сформувати експорт (${response.status})`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = getFileName(response, `journal-monitor.${format}`);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      showSuccess(`Експорт ${format.toUpperCase()} сформовано`);
    } catch (error) {
      showError((error as Error).message);
    }
  };

  const renderBoolean = (value: boolean) => (
    <span className={clsx("font-semibold", value ? "text-emerald-700" : "text-slate-400")}>{value ? "Так" : "Ні"}</span>
  );

  return (
    <div className="space-y-5">
      {errorText && <InlineNotice tone="error" text={errorText} actionLabel="Спробувати ще раз" onAction={() => syncSelected()} />}

      <Panel title="Моніторинг журналів Google Drive">
        <form className="grid gap-3 lg:grid-cols-[14rem_1fr_auto]" onSubmit={createSection}>
          <label className="text-sm font-semibold text-slate-700">
            Назва розділу
            <input
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Журнали 2026"
              required
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            URL папки Google Drive
            <input
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              value={folderUrl}
              onChange={(event) => setFolderUrl(event.target.value)}
              placeholder="https://drive.google.com/drive/folders/..."
              required
            />
          </label>
          <button
            type="submit"
            className="self-end rounded-lg bg-pine px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={isSaving}
          >
            {isSaving ? "Створюємо..." : "Додати"}
          </button>
        </form>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <Panel title="Розділи">
          {sections.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Додайте перший розділ з посиланням на папку журналів.
            </div>
          ) : (
            <div className="space-y-2">
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className={clsx(
                    "w-full rounded-lg border px-3 py-2 text-left text-sm transition",
                    selectedId === section.id ? "border-pine bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50"
                  )}
                  onClick={() => setSelectedId(section.id)}
                >
                  <span className="block font-semibold text-ink">{section.name}</span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {section.stats.total} папок, оновлено: {formatDateTime(section.last_synced_at)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <Panel title={detail?.name || "Поточний стан"}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-3 lg:grid-cols-5">
              <span>Усього: <b className="text-ink">{detail?.stats.total ?? 0}</b></span>
              <span>Повністю: <b className="text-emerald-700">{detail?.stats.complete ?? 0}</b></span>
              <span>Тільки розклад: <b className="text-sky-700">{detail?.stats.schedule_only ?? 0}</b></span>
              <span>Тільки слухачі: <b className="text-amber-700">{detail?.stats.trainees_only ?? 0}</b></span>
              <span>Не опрацьовано: <b className="text-rose-700">{detail?.stats.not_processed ?? 0}</b></span>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-pine px-3 py-2 text-sm font-semibold text-pine disabled:opacity-50"
                onClick={() => syncSelected()}
                disabled={!selectedId || isSyncing}
              >
                {isSyncing ? "Оновлюємо..." : "Оновити"}
              </button>
              {EXPORT_FORMATS.map((format) => (
                <button
                  key={format}
                  type="button"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold uppercase text-slate-700 disabled:opacity-50"
                  onClick={() => exportSection(format)}
                  disabled={!selectedId}
                >
                  {format === "xlsx" ? "xls" : format}
                </button>
              ))}
            </div>
          </div>

          <p className="mb-3 text-xs text-slate-500">
            Остання синхронізація: {formatDateTime(detail?.last_synced_at ?? null)}
          </p>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-[58rem] w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Група</th>
                  <th className="px-3 py-2">Папка журналу</th>
                  <th className="px-3 py-2">Статус</th>
                  <th className="px-3 py-2">Розклад</th>
                  <th className="px-3 py-2">Слухачі</th>
                  <th className="px-3 py-2">Занять</th>
                  <th className="px-3 py-2">Осіб</th>
                  <th className="px-3 py-2">Drive</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rows.map((row: JournalMonitorEntry) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2 font-semibold text-ink">{row.group_code || "—"}</td>
                    <td className="px-3 py-2">{row.journal_name}</td>
                    <td className="px-3 py-2">
                      <span className={clsx("rounded-full px-2 py-1 text-xs font-semibold", STATUS_CLASSES[row.processing_status] || STATUS_CLASSES.unknown_code)}>
                        {formatStatus(row.processing_status)}
                      </span>
                    </td>
                    <td className="px-3 py-2">{renderBoolean(row.has_schedule)}</td>
                    <td className="px-3 py-2">{renderBoolean(row.has_trainees)}</td>
                    <td className="px-3 py-2">{row.schedule_lessons}</td>
                    <td className="px-3 py-2">{row.trainee_count}</td>
                    <td className="px-3 py-2">
                      {row.drive_url ? (
                        <a className="font-semibold text-pine underline" href={row.drive_url} target="_blank" rel="noreferrer">
                          Відкрити
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
                {!isLoading && rows.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center text-slate-500" colSpan={8}>
                      Даних ще немає. Натисніть «Оновити» після створення розділу.
                    </td>
                  </tr>
                )}
                {isLoading && (
                  <tr>
                    <td className="px-3 py-6 text-center text-slate-500" colSpan={8}>
                      Завантаження...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
