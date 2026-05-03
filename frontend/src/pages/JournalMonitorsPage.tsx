import clsx from "clsx";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { API_URL } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
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

const PROGRESS_CARDS = [
  {
    key: "complete",
    title: "Розклад і слухачі",
    caption: "Є обидві частини",
    barClass: "bg-emerald-600",
    valueClass: "text-emerald-700"
  },
  {
    key: "schedule_only",
    title: "Тільки розклад",
    caption: "Списку слухачів ще немає",
    barClass: "bg-sky-600",
    valueClass: "text-sky-700"
  },
  {
    key: "trainees_only",
    title: "Тільки слухачі",
    caption: "Розкладу ще немає",
    barClass: "bg-amber-500",
    valueClass: "text-amber-700"
  },
  {
    key: "not_processed",
    title: "Не опрацьовано",
    caption: "Немає розкладу і слухачів",
    barClass: "bg-rose-600",
    valueClass: "text-rose-700"
  }
] as const;

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

function formatPercent(count = 0, total = 0): string {
  if (total <= 0) return "0%";
  return `${Math.round((count / total) * 100)}%`;
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
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [entriesExpanded, setEntriesExpanded] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const selectedSection = useMemo(
    () => sections.find((section) => section.id === selectedId) || null,
    [sections, selectedId]
  );
  const rows = detail?.entries || [];
  const totalFolders = detail?.stats.total ?? 0;

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

  const deleteSelectedSection = async () => {
    if (!selectedId) return;
    setIsDeleting(true);
    try {
      const deletedName = detail?.name || selectedSection?.name || "розділ";
      await request<void>(`/journal-monitors/${selectedId}`, { method: "DELETE" });
      const remaining = sections.filter((section) => section.id !== selectedId);
      setSections(remaining);
      const nextSelectedId = remaining[0]?.id ?? null;
      setSelectedId(nextSelectedId);
      if (nextSelectedId) {
        await loadDetail(nextSelectedId);
      } else {
        setDetail(null);
      }
      setDeleteDialogOpen(false);
      showSuccess(`Розділ «${deletedName}» видалено`);
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsDeleting(false);
    }
  };

  const renderBoolean = (value: boolean) => (
    <span className={clsx("font-semibold", value ? "text-emerald-700" : "text-slate-400")}>{value ? "Так" : "Ні"}</span>
  );

  return (
    <div className="space-y-5">
      {errorText && <InlineNotice tone="error" text={errorText} actionLabel="Спробувати ще раз" onAction={() => syncSelected(false)} />}

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

      <section className="rounded-2xl bg-white p-5 shadow-card">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-xl font-semibold text-ink">{detail?.name || "Поточний стан"}</h2>
            <p className="mt-2 text-xs text-slate-500">
              {detail
                ? `${detail.stats.total} папок, оновлено: ${formatDateTime(detail.last_synced_at)}`
                : "Додайте перший розділ з посиланням на папку журналів."}
            </p>
          </div>
          {sections.length > 1 && (
            <label className="text-xs font-semibold text-slate-600">
              Розділ для перегляду
              <select
                className="mt-1 block min-w-48 rounded border border-slate-300 px-3 py-2 text-sm font-normal text-ink"
                value={selectedId ?? ""}
                onChange={(event) => setSelectedId(Number(event.target.value))}
              >
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <h3 className="mb-3 font-heading text-lg font-semibold text-ink">Опрацювання журналів</h3>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PROGRESS_CARDS.map((card) => {
            const value = detail?.stats[card.key] ?? 0;
            const percent = formatPercent(value, totalFolders);
            return (
              <div key={card.key} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-ink">{card.title}</h3>
                    <p className="mt-1 text-xs text-slate-500">{card.caption}</p>
                  </div>
                  <p className={clsx("font-heading text-2xl font-bold", card.valueClass)}>{percent}</p>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                  <div className={clsx("h-full rounded-full", card.barClass)} style={{ width: percent }} />
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  {value} з {totalFolders} папок
                </p>
              </div>
            );
          })}
        </div>

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
            <button
              type="button"
              className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={!selectedId || isDeleting}
            >
              Видалити розділ
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <button
            type="button"
            className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
            onClick={() => setEntriesExpanded((value) => !value)}
            aria-expanded={entriesExpanded}
            aria-controls="journal-monitor-entries"
          >
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">Список журналів</p>
              <p className="text-xs text-slate-600">
                Папок: {rows.length} | Повністю: {detail?.stats.complete ?? 0} | Не опрацьовано: {detail?.stats.not_processed ?? 0}
              </p>
            </div>
            <span className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-pine text-lg font-bold text-white">
              {entriesExpanded ? "−" : "+"}
            </span>
          </button>

          {entriesExpanded && (
            <div id="journal-monitor-entries" className="border-t border-slate-200">
              <div className="overflow-x-auto">
                <table className="min-w-[58rem] w-full text-left text-sm xl:min-w-full">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Група</th>
                      <th className="px-3 py-2">Папка журналу</th>
                      <th className="px-3 py-2 whitespace-nowrap">Статус</th>
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
                          <span className={clsx("whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold", STATUS_CLASSES[row.processing_status] || STATUS_CLASSES.unknown_code)}>
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
            </div>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={deleteDialogOpen}
        title="Видалити розділ журналів"
        description={`Видалити «${detail?.name || selectedSection?.name || "цей розділ"}» з проєкту? Записи моніторингу цього розділу буде прибрано з бази, але папки на Google Drive не зміняться.`}
        confirmLabel={isDeleting ? "Видаляємо..." : "Видалити"}
        confirmDisabled={isDeleting}
        onConfirm={deleteSelectedSection}
        onCancel={() => setDeleteDialogOpen(false)}
      />
    </div>
  );
}
