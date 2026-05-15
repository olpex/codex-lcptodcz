import clsx from "clsx";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { InlineNotice } from "../components/InlineNotice";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { usePageRefresh } from "../hooks/usePageRefresh";
import type { JournalDailyActivityItem, JournalMonitorEntry, JournalMonitorEntryBulkDeleteResponse, JournalMonitorSection } from "../types/api";

const EXPORT_FORMATS = ["xlsx", "pdf", "docx", "csv"] as const;

const STATUS_LABELS: Record<string, string> = {
  complete: "Опрацьовано",
  schedule_only: "Тільки розклад",
  trainees_only: "Тільки слухачі",
  not_processed: "Не опрацьовано",
  unknown_code: "Без номера групи",
  workload_only: "Тільки педнавантаження",
  with_workload: "Є педнавантаження",
  without_workload: "Немає педнавантаження"
};

const PROCESSING_STATUS_FILTERS = new Set(["complete", "schedule_only", "trainees_only", "not_processed", "unknown_code"]);
const WORKLOAD_STATUS_FILTERS = new Set(["workload_only", "with_workload", "without_workload"]);
const JOURNAL_PROCESSING_REFRESH_INTERVAL_MS = 30_000;
const JOURNAL_ACTIVITY_REFRESH_INTERVAL_MS = 45_000;

const STATUS_CLASSES: Record<string, string> = {
  complete: "bg-emerald-100 text-emerald-800",
  schedule_only: "bg-sky-100 text-sky-800",
  trainees_only: "bg-amber-100 text-amber-800",
  not_processed: "bg-rose-100 text-rose-800",
  unknown_code: "bg-slate-100 text-slate-700",
  workload_only: "bg-violet-100 text-violet-800",
  workload_and_trainees: "bg-violet-800 text-violet-100"
};

const WORKLOAD_STATUS_LABELS: Record<string, string> = {
  pending: "Очікує",
  processed: "Додано",
  failed: "Помилка",
  no_data: "Н/даних",
  skipped_year: "Пропущено за роком",
  needs_regeneration: "Повторити"
};

const WORKLOAD_STATUS_CLASSES: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700",
  processed: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
  no_data: "bg-rose-100 text-rose-800",
  skipped_year: "bg-amber-100 text-amber-800",
  needs_regeneration: "bg-violet-100 text-violet-800"
};

const TRAINEES_STATUS_LABELS: Record<string, string> = {
  pending: "Очікує",
  processed: "Так",
  failed: "Помилка",
  no_data: "Н/даних"
};

const TRAINEES_STATUS_CLASSES: Record<string, string> = {
  pending: "text-slate-400",
  processed: "text-emerald-700",
  failed: "text-rose-700",
  no_data: "text-rose-700"
};

const NO_DATA_BADGE_CLASSES = "whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold bg-rose-100 text-rose-800";

const PROGRESS_CARDS = [
  {
    key: "workload_only",
    title: "Тільки педнавантаження",
    caption: "Немає розкладу і слухачів",
    barClass: "bg-violet-600",
    valueClass: "text-violet-700"
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
  },
  {
    key: "workload_and_trainees",
    title: "Педнавантаження і слухачі",
    caption: "Є години з журналу і список слухачів",
    barClass: "bg-teal-600",
    valueClass: "text-teal-700"
  },
  {
    key: "workload_trainees_schedule",
    title: "Педнавантаження, слухачі і розклад",
    caption: "Є всі три частини",
    barClass: "bg-lime-600",
    valueClass: "text-lime-700"
  }
] as const;

type SortKey = "group" | "journal" | "status" | "workload" | "schedule" | "trainees";
type SortDirection = "asc" | "desc";

const STATUS_SORT_ORDER: Record<string, number> = {
  complete: 1,
  schedule_only: 2,
  trainees_only: 3,
  not_processed: 4,
  unknown_code: 5
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

function formatKyivTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Kyiv"
  });
}

function formatStatus(value: string): string {
  return STATUS_LABELS[value] || value;
}

function formatWorkloadStatus(value: string): string {
  return WORKLOAD_STATUS_LABELS[value] || value;
}

function formatTraineesStatus(value: string): string {
  return TRAINEES_STATUS_LABELS[value] || value;
}

function formatWorkloadTeacherHours(value: number): string {
  return Number(value || 0).toLocaleString("uk-UA", {
    maximumFractionDigits: 2
  });
}

function getWorkloadStatusTitle(row: JournalMonitorEntry): string | undefined {
  if (row.workload_status === "processed" && row.workload_teachers?.length > 0) {
    return row.workload_teachers
      .map((teacher) => `${teacher.teacher_name} (${formatWorkloadTeacherHours(teacher.hours)} год)`)
      .join("\n");
  }
  return row.workload_message || undefined;
}

function formatPercent(count = 0, total = 0): string {
  if (total <= 0) return "0%";
  return `${Math.round((count / total) * 100)}%`;
}

function hasDailyActivity(section: JournalMonitorSection): boolean {
  const activity = section.daily_activity;
  return Boolean(activity && (activity.created_count > 0 || activity.changed_count > 0));
}

function getDriveStateNotice(section: JournalMonitorSection | null): { tone: "info" | "error"; text: string } | null {
  if (!section) return null;
  if (section.last_sync_status === "failed") {
    return {
      tone: "error",
      text: `Немає доступу до Google Drive. ${
        section.last_sync_message || "Перевірте доступ до папки, service account або Google Drive API."
      }`
    };
  }
  if (section.last_sync_status !== "never" && section.stats.total === 0) {
    return {
      tone: "info",
      text: "Папка Google Drive порожня. Перевірте, чи у вибраній папці є журнали груп, або оновіть моніторинг після додавання файлів."
    };
  }
  return null;
}

function normalizeSearchValue(value: string | null | undefined): string {
  return (value || "").toLocaleLowerCase("uk-UA").trim();
}

function hasProcessedWorkload(row: JournalMonitorEntry): boolean {
  return row.workload_status === "processed";
}

function matchesStatusFilter(row: JournalMonitorEntry, filter: string): boolean {
  if (!filter) return true;
  if (filter === "workload_only") return hasProcessedWorkload(row) && !row.has_schedule && !row.has_trainees;
  if (filter === "with_workload") return hasProcessedWorkload(row);
  if (filter === "without_workload") return !hasProcessedWorkload(row);
  return row.processing_status === filter;
}

function getDisplayStatus(row: JournalMonitorEntry): string {
  if (row.has_schedule && row.has_trainees) return "complete";
  if (hasProcessedWorkload(row) && row.has_trainees) return "workload_and_trainees";
  if (hasProcessedWorkload(row) && !row.has_schedule && !row.has_trainees) return "workload_only";
  return row.processing_status;
}

function formatDisplayStatus(row: JournalMonitorEntry): string {
  const status = getDisplayStatus(row);
  if (status === "workload_and_trainees") return "Пед.+слухачі";
  return formatStatus(status);
}

function renderDisplayStatus(row: JournalMonitorEntry) {
  const status = getDisplayStatus(row);
  if (status === "workload_only") {
    return (
      <>
        Тільки{" "}
        <br />
        педнавантаження
      </>
    );
  }
  return formatDisplayStatus(row);
}

function getGroupSortParts(code: string | null): { number: number; suffix: string; year: number; raw: string } {
  const raw = code || "";
  const match = raw.match(/^\s*(\d+)\s*([^\d\s-]*)\s*-\s*(\d+)/i);
  if (!match) {
    return { number: Number.MAX_SAFE_INTEGER, suffix: "", year: Number.MAX_SAFE_INTEGER, raw };
  }
  return {
    number: Number(match[1]),
    suffix: match[2] || "",
    year: Number(match[3]),
    raw
  };
}

function getJournalNameSortValue(name: string): string {
  return name.replace(/^\s*\d+\s*[^\d\s-]*\s*-\s*\d+\s*[-—–:]?\s*/i, "").trim() || name;
}

function compareGroupCodes(left: string | null, right: string | null): number {
  const a = getGroupSortParts(left);
  const b = getGroupSortParts(right);
  if (a.number !== b.number) return a.number - b.number;
  const suffixCompare = a.suffix.localeCompare(b.suffix, "uk-UA", { sensitivity: "base" });
  if (suffixCompare !== 0) return suffixCompare;
  if (a.year !== b.year) return a.year - b.year;
  return a.raw.localeCompare(b.raw, "uk-UA", { sensitivity: "base", numeric: true });
}

function compareJournalRows(left: JournalMonitorEntry, right: JournalMonitorEntry, sortKey: SortKey): number {
  if (sortKey === "group") {
    return compareGroupCodes(left.group_code, right.group_code);
  }
  if (sortKey === "journal") {
    return getJournalNameSortValue(left.journal_name).localeCompare(getJournalNameSortValue(right.journal_name), "uk-UA", {
      sensitivity: "base",
      numeric: true
    });
  }
  if (sortKey === "status") {
    return (STATUS_SORT_ORDER[left.processing_status] ?? 99) - (STATUS_SORT_ORDER[right.processing_status] ?? 99);
  }
  if (sortKey === "workload") {
    return (left.workload_status || "").localeCompare(right.workload_status || "", "uk-UA", {
      sensitivity: "base"
    });
  }
  if (sortKey === "schedule") {
    return Number(right.has_schedule) - Number(left.has_schedule);
  }
  return Number(right.has_trainees) - Number(left.has_trainees);
}

function getFileName(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition") || "";
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch) return decodeURIComponent(utfMatch[1]);
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] || fallback;
}

function pickDefaultSectionId(sections: JournalMonitorSection[], currentYear = new Date().getFullYear()): number | null {
  if (!sections.length) return null;
  const exactName = `журнали ${currentYear}`;
  const exactMatch = sections.find((section) => section.name.trim().toLocaleLowerCase("uk-UA") === exactName);
  if (exactMatch) return exactMatch.id;
  const yearMatch = sections.find((section) => new RegExp(`(^|\\D)${currentYear}(\\D|$)`).test(section.name));
  return yearMatch?.id ?? sections[0].id;
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
  const [isProcessingJournals, setIsProcessingJournals] = useState(false);
  const [isTogglingSectionActive, setIsTogglingSectionActive] = useState(false);
  const [workloadYear, setWorkloadYear] = useState(String(new Date().getFullYear()));
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState<JournalMonitorEntry | null>(null);
  const [isDeletingEntry, setIsDeletingEntry] = useState(false);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Record<number, boolean>>({});
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [isBulkDeletingEntries, setIsBulkDeletingEntries] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [entriesExpanded, setEntriesExpanded] = useState(false);
  const [journalSearch, setJournalSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [scheduleFilter, setScheduleFilter] = useState("");
  const [traineesFilter, setTraineesFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [errorText, setErrorText] = useState<string | null>(null);
  const backgroundStepInFlightRef = useRef(false);

  const selectedSection = useMemo(
    () => sections.find((section) => section.id === selectedId) || null,
    [sections, selectedId]
  );
  const rows = detail?.entries || [];
  const totalFolders = detail?.stats.total ?? 0;
  const sectionActive = detail?.is_active !== false;
  const visibleRows = useMemo(() => {
    const query = normalizeSearchValue(journalSearch);
    const filtered = query
      ? rows.filter((row) => {
          const groupCode = normalizeSearchValue(row.group_code);
          const journalName = normalizeSearchValue(row.journal_name);
          return groupCode.includes(query) || journalName.includes(query);
        })
      : rows;
    const statusFiltered = filtered.filter((row) => matchesStatusFilter(row, statusFilter));
    const scheduleFiltered = scheduleFilter
      ? statusFiltered.filter((row) => row.has_schedule === (scheduleFilter === "true"))
      : statusFiltered;
    const traineesFiltered = traineesFilter
      ? scheduleFiltered.filter((row) => row.has_trainees === (traineesFilter === "true"))
      : scheduleFiltered;
    if (!sortKey) return traineesFiltered;
    return [...traineesFiltered].sort((left, right) => {
      const result = compareJournalRows(left, right, sortKey);
      return sortDirection === "asc" ? result : -result;
    });
  }, [journalSearch, rows, scheduleFilter, sortDirection, sortKey, statusFilter, traineesFilter]);
  const selectedEntries = useMemo(
    () => rows.filter((row) => selectedEntryIds[row.id]),
    [rows, selectedEntryIds]
  );
  const selectedEntryCount = selectedEntries.length;
  const allVisibleEntriesSelected = visibleRows.length > 0 && visibleRows.every((row) => selectedEntryIds[row.id]);
  const driveStateNotice = getDriveStateNotice(detail);

  const loadSections = async () => {
    const data = await request<JournalMonitorSection[]>("/journal-monitors");
    setSections(data);
    if (data.length > 0 && !selectedId) {
      setSelectedId(pickDefaultSectionId(data));
    }
    if (data.length === 0) {
      setDetail(null);
    }
    return data;
  };

  const loadDetail = async (sectionId: number) => {
      const data = await request<JournalMonitorSection>(`/journal-monitors/${sectionId}`);
      setDetail(data);
      setSelectedEntryIds((prev) => {
        const availableIds = new Set((data.entries || []).map((entry) => entry.id));
        return Object.fromEntries(
          Object.entries(prev)
            .filter(([id, selected]) => selected && availableIds.has(Number(id)))
            .map(([id]) => [Number(id), true])
        );
      });
      return data;
  };

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await loadSections();
      const nextSelectedId = selectedId || pickDefaultSectionId(data);
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
    if (!sectionId || !sectionActive) return;
    setIsSyncing(true);
    try {
      const data = await request<JournalMonitorSection>(`/journal-monitors/${sectionId}/sync`, { method: "POST" });
      setDetail(data);
      if (hasDailyActivity(data)) {
        setActivityExpanded(true);
      }
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

  const runBackgroundStep = async (sectionId: number, year: number) => {
    if (backgroundStepInFlightRef.current) return;
    backgroundStepInFlightRef.current = true;
    const query = Number.isInteger(year) && year >= 2025 && year <= 2100 ? `?year=${year}` : "";
    try {
      const data = await request<JournalMonitorSection>(`/journal-monitors/${sectionId}/processing/background-tick${query}`, {
        method: "POST"
      });
      setDetail(data);
      await loadSections();
      setErrorText(null);
    } catch (error) {
      setErrorText((error as Error).message);
    } finally {
      backgroundStepInFlightRef.current = false;
    }
  };

  const processSelectedBackgroundStep = async () => {
    const sectionId = selectedId || selectedSection?.id;
    if (!sectionId || !sectionActive) return;
    await runBackgroundStep(sectionId, Number(workloadYear));
    await syncSelected(false);
  };

  const refreshSelectedActivity = async () => {
    if (!sectionActive || detail?.workload_auto_enabled || isSyncing) return;
    await syncSelected(false);
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

  usePageRefresh(processSelectedBackgroundStep, {
    enabled: Boolean(selectedId && sectionActive && detail?.workload_auto_enabled),
    intervalMs: JOURNAL_PROCESSING_REFRESH_INTERVAL_MS,
    refreshOnFocus: false
  });

  usePageRefresh(refreshSelectedActivity, {
    enabled: Boolean(selectedId && detail && sectionActive && !detail.workload_auto_enabled),
    intervalMs: JOURNAL_ACTIVITY_REFRESH_INTERVAL_MS,
    refreshOnFocus: true
  });

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
      const params = new URLSearchParams({ format });
      if (journalSearch.trim()) params.set("q", journalSearch.trim());
      if (PROCESSING_STATUS_FILTERS.has(statusFilter)) params.set("status", statusFilter);
      if (WORKLOAD_STATUS_FILTERS.has(statusFilter)) params.set("workload", statusFilter);
      if (scheduleFilter) params.set("has_schedule", scheduleFilter);
      if (traineesFilter) params.set("has_trainees", traineesFilter);
      const response = await fetch(`${API_URL}/journal-monitors/${selectedId}/export?${params.toString()}`, {
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

  const toggleJournalProcessing = async () => {
    if (!selectedId || !sectionActive) return;
    if (detail?.workload_auto_enabled) {
      setIsProcessingJournals(true);
      try {
        const data = await request<JournalMonitorSection>(`/journal-monitors/${selectedId}/processing/stop`, {
          method: "POST"
        });
        setDetail(data);
        await loadSections();
        showInfo("Автоопрацювання журналів зупинено");
      } catch (error) {
        showError((error as Error).message);
      } finally {
        setIsProcessingJournals(false);
      }
      return;
    }
    const year = Number(workloadYear);
    if (!Number.isInteger(year) || year < 2025 || year > 2100) {
      showError("Вкажіть рік від 2025 до 2100");
      return;
    }
    setIsProcessingJournals(true);
    try {
      const data = await request<JournalMonitorSection>(
        `/journal-monitors/${selectedId}/processing/start?year=${year}`,
        { method: "POST" }
      );
      setDetail(data);
      await loadSections();
      showSuccess(`Опрацювання журналів для ${year} року поставлено в чергу: слухачі та години`);
      void runBackgroundStep(selectedId, year);
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsProcessingJournals(false);
    }
  };

  const reprocessAllJournals = async () => {
    if (!selectedId || !sectionActive) return;
    const year = Number(workloadYear);
    if (!Number.isInteger(year) || year < 2025 || year > 2100) {
      showError("Вкажіть рік від 2025 до 2100");
      return;
    }
    setIsProcessingJournals(true);
    try {
      const data = await request<JournalMonitorSection>(
        `/journal-monitors/${selectedId}/processing/reprocess-all?year=${year}`,
        { method: "POST" }
      );
      setDetail(data);
      await loadSections();
      showSuccess(`Повну переобробку журналів для ${year} року поставлено в чергу`);
      void runBackgroundStep(selectedId, year).then(() => syncSelected(false));
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsProcessingJournals(false);
    }
  };

  const toggleSelectedSectionActive = async () => {
    if (!selectedId || isTogglingSectionActive) return;
    const nextActive = !sectionActive;
    setIsTogglingSectionActive(true);
    try {
      const data = await request<JournalMonitorSection>(`/journal-monitors/${selectedId}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: nextActive })
      });
      setDetail(data);
      await loadSections();
      showSuccess(nextActive ? "Розділ активовано" : "Розділ архівовано");
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsTogglingSectionActive(false);
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

  const deleteJournalEntry = async () => {
    if (!selectedId || !entryToDelete) return;
    setIsDeletingEntry(true);
    try {
      await request<void>(`/journal-monitors/${selectedId}/entries/${entryToDelete.id}`, { method: "DELETE" });
      const data = await loadDetail(selectedId);
      await loadSections();
      setEntryToDelete(null);
      showSuccess(`Журнал «${entryToDelete.group_code || entryToDelete.journal_name}» видалено з моніторингу`);
      setDetail(data);
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsDeletingEntry(false);
    }
  };

  const toggleEntrySelection = (entryId: number) => {
    setSelectedEntryIds((prev) => {
      const next = { ...prev };
      if (next[entryId]) {
        delete next[entryId];
      } else {
        next[entryId] = true;
      }
      return next;
    });
  };

  const toggleVisibleEntrySelection = () => {
    if (allVisibleEntriesSelected) {
      setSelectedEntryIds((prev) => {
        const next = { ...prev };
        visibleRows.forEach((row) => delete next[row.id]);
        return next;
      });
      return;
    }
    setSelectedEntryIds((prev) => ({
      ...prev,
      ...Object.fromEntries(visibleRows.map((row) => [row.id, true]))
    }));
  };

  const bulkDeleteJournalEntries = async () => {
    if (!selectedId || !selectedEntryCount) return;
    setIsBulkDeletingEntries(true);
    try {
      const response = await request<JournalMonitorEntryBulkDeleteResponse>(
        `/journal-monitors/${selectedId}/entries/bulk-delete`,
        {
          method: "POST",
          body: JSON.stringify({ entry_ids: selectedEntries.map((entry) => entry.id) })
        }
      );
      setSelectedEntryIds((prev) => {
        const next = { ...prev };
        response.deleted_ids.forEach((id) => delete next[id]);
        return next;
      });
      await loadDetail(selectedId);
      await loadSections();
      setBulkDeleteDialogOpen(false);
      showSuccess(`Видалено журналів: ${response.deleted_count}; приховано груп: ${response.hidden_group_count}`);
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsBulkDeletingEntries(false);
    }
  };

  const renderBoolean = (value: boolean) => (
    <span className={clsx("font-semibold", value ? "text-emerald-700" : "text-slate-400")}>{value ? "Так" : "Ні"}</span>
  );

  const renderNoDataBadge = (message?: string | null) => (
    <span className={NO_DATA_BADGE_CLASSES} title={message || undefined}>Н/даних</span>
  );

  const renderTraineesState = (row: JournalMonitorEntry) => {
    const value = row.has_trainees ? "processed" : row.trainees_status || "pending";
    if (value === "pending") {
      return <span className="font-semibold text-slate-400">Ні</span>;
    }
    if (value === "no_data") {
      return renderNoDataBadge(row.trainees_message);
    }
    return (
      <span
        className={clsx("font-semibold", TRAINEES_STATUS_CLASSES[value] || TRAINEES_STATUS_CLASSES.pending)}
        title={row.trainees_message || undefined}
      >
        {formatTraineesStatus(value)}
      </span>
    );
  };

  const renderWorkloadHours = (row: JournalMonitorEntry) => {
    if (row.workload_status === "no_data") {
      if (row.workload_hours > 0) return row.workload_hours;
      return renderNoDataBadge(row.workload_message);
    }
    return row.workload_hours || 0;
  };

  const renderTraineeCount = (row: JournalMonitorEntry) => {
    if (row.trainees_status === "no_data") {
      return renderNoDataBadge(row.trainees_message);
    }
    return row.trainee_count;
  };

  const renderActivityTitle = (item: JournalDailyActivityItem) => {
    const subjectName = getJournalNameSortValue(item.journal_name);
    if (!item.group_code) return item.journal_name;
    if (!subjectName || subjectName === item.journal_name) return item.group_code;
    return `${item.group_code} ${subjectName}`;
  };

  const renderActivityRow = (item: JournalDailyActivityItem, kind: "created" | "changed") => {
    const title = renderActivityTitle(item);
    const titleClass = clsx(
      "block truncate text-sm font-semibold",
      item.drive_url ? "text-pine underline decoration-pine/40 underline-offset-2 hover:text-ink" : "text-ink"
    );

    return (
      <li key={`${kind}-${item.id}`} className="border-t border-slate-100 py-1.5 first:border-t-0 first:pt-0 last:pb-0">
        {item.drive_url ? (
          <a className={titleClass} href={item.drive_url} target="_blank" rel="noreferrer" title={item.journal_name}>
            {title}
          </a>
        ) : (
          <p className={titleClass} title={item.journal_name}>
            {title}
          </p>
        )}
        {kind === "created" ? (
          <p className="truncate text-xs text-slate-500">Створено: {formatKyivTime(item.created_at)}</p>
        ) : (
          <p className="truncate text-xs text-slate-500">
            Початок змін: {formatKyivTime(item.change_started_at)} | Остання зміна: {formatKyivTime(item.modified_at)}
          </p>
        )}
      </li>
    );
  };

  const changeSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };

  const renderSortButton = (key: SortKey, label: string) => (
    <button
      type="button"
      className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide text-slate-500 hover:text-pine"
      onClick={() => changeSort(key)}
      aria-sort={sortKey === key ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
    >
      {label}
      <span aria-hidden="true">{sortKey === key ? (sortDirection === "asc" ? "▲" : "▼") : "↕"}</span>
    </button>
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
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-xl font-semibold text-ink">{detail?.name || "Поточний стан"}</h2>
              {detail && (
                <span
                  className={clsx(
                    "rounded-full px-2 py-1 text-xs font-semibold",
                    sectionActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"
                  )}
                >
                  {sectionActive ? "Активний" : "Архівовано"}
                </span>
              )}
            </div>
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
                    {section.is_active === false ? " (архів)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {detail?.daily_activity && (
          <div className="mb-4 overflow-hidden border-y border-slate-200">
            <button
              type="button"
              className="flex w-full items-start justify-between gap-3 py-3 text-left hover:bg-slate-50"
              onClick={() => setActivityExpanded((value) => !value)}
              aria-expanded={activityExpanded}
              aria-controls="journal-monitor-activity"
            >
              <div className="min-w-0">
                <h3 className="font-heading text-lg font-semibold text-ink">Активність з 08:00</h3>
                <p className="text-xs text-slate-500">Відлік: {formatKyivTime(detail.daily_activity.cutoff_at)}</p>
              </div>
              <div className="flex gap-2 text-xs font-semibold text-slate-600">
                <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">
                  Створено: {detail.daily_activity.created_count}
                </span>
                <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-700">
                  Змінено: {detail.daily_activity.changed_count}
                </span>
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-pine text-lg font-bold leading-none text-white">
                  {activityExpanded ? "−" : "+"}
                </span>
              </div>
            </button>
            {activityExpanded && (
              <div id="journal-monitor-activity" className="grid gap-4 border-t border-slate-200 py-3 lg:grid-cols-2">
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-ink">Створені журнали</h4>
                  {detail.daily_activity.created.length > 0 ? (
                    <ul>{detail.daily_activity.created.map((item) => renderActivityRow(item, "created"))}</ul>
                  ) : (
                    <p className="text-sm text-slate-500">Нових журналів з 08:00 немає.</p>
                  )}
                </div>
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-ink">Змінені журнали</h4>
                  {detail.daily_activity.changed.length > 0 ? (
                    <ul>{detail.daily_activity.changed.map((item) => renderActivityRow(item, "changed"))}</ul>
                  ) : (
                    <p className="text-sm text-slate-500">Змін у журналах з 08:00 немає.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {detail && !sectionActive && (
          <InlineNotice
            className="mb-4"
            tone="info"
            text="Розділ вимкнено для автоматичного опрацювання. Активуйте його, щоб знову запускати синхронізацію та фонову обробку."
          />
        )}

        {driveStateNotice && <InlineNotice className="mb-4" tone={driveStateNotice.tone} text={driveStateNotice.text} />}

        <h3 className="mb-3 font-heading text-lg font-semibold text-ink">Опрацювання журналів</h3>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
          <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            <span>Усього: <b className="text-ink">{detail?.stats.total ?? 0}</b></span>
            <span>Повністю: <b className="text-emerald-700">{detail?.stats.complete ?? 0}</b></span>
            <span>Тільки розклад: <b className="text-sky-700">{detail?.stats.schedule_only ?? 0}</b></span>
            <span>Тільки слухачі: <b className="text-amber-700">{detail?.stats.trainees_only ?? 0}</b></span>
            <span>Не опрацьовано: <b className="text-rose-700">{detail?.stats.not_processed ?? 0}</b></span>
            <span>Пед.+слухачі: <b className="text-teal-700">{detail?.stats.workload_and_trainees ?? 0}</b></span>
            <span>Пед. + слухачі + розклад: <b className="text-lime-700">{detail?.stats.workload_trainees_schedule ?? 0}</b></span>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Рік
              <input
                className="w-20 rounded-lg border border-slate-300 px-2 py-2 text-sm font-normal tracking-normal text-ink"
                value={workloadYear}
              onChange={(event) => setWorkloadYear(event.target.value)}
              inputMode="numeric"
              disabled={!sectionActive || Boolean(detail?.workload_auto_enabled) || isProcessingJournals}
            />
          </label>
          <button
            type="button"
            className={clsx(
              "rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50",
              detail?.workload_auto_enabled
                ? "border-rose-300 text-rose-700 hover:bg-rose-50"
                : "border-emerald-500 text-emerald-700"
            )}
            onClick={toggleJournalProcessing}
            disabled={!selectedId || !sectionActive || isProcessingJournals}
          >
            {isProcessingJournals
              ? "Змінюємо..."
              : detail?.workload_auto_enabled
                ? "Зупинити опрацювання"
                : "Почати опрацювання"}
          </button>
            <button
              type="button"
              className="rounded-lg border border-violet-500 px-3 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
              onClick={reprocessAllJournals}
              disabled={!selectedId || !sectionActive || Boolean(detail?.workload_auto_enabled) || isProcessingJournals}
            >
              Переобробити все
            </button>
            <button
              type="button"
              className="rounded-lg border border-pine px-3 py-2 text-sm font-semibold text-pine disabled:opacity-50"
              onClick={() => syncSelected()}
              disabled={!selectedId || !sectionActive || isSyncing}
            >
              {isSyncing ? "Оновлюємо..." : "Оновити"}
            </button>
            {detail && (
              <button
                type="button"
                className={clsx(
                  "rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50",
                  sectionActive
                    ? "border-slate-300 text-slate-700 hover:bg-slate-50"
                    : "border-emerald-500 text-emerald-700 hover:bg-emerald-50"
                )}
                onClick={toggleSelectedSectionActive}
                disabled={!selectedId || isTogglingSectionActive}
              >
                {isTogglingSectionActive ? "Змінюємо..." : sectionActive ? "Архівувати розділ" : "Активувати розділ"}
              </button>
            )}
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
                Папок: {rows.length} | Показано: {visibleRows.length} | Повністю: {detail?.stats.complete ?? 0} | Не опрацьовано: {detail?.stats.not_processed ?? 0}
              </p>
            </div>
            <span className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-pine text-lg font-bold text-white">
              {entriesExpanded ? "−" : "+"}
            </span>
          </button>

          {entriesExpanded && (
            <div id="journal-monitor-entries" className="border-t border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                    onClick={toggleVisibleEntrySelection}
                    disabled={!visibleRows.length}
                  >
                    {allVisibleEntriesSelected ? "Зняти вибір" : "Вибрати показані"}
                  </button>
                  <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-slate-700">
                    Вибрано: {selectedEntryCount}
                  </span>
                  <button
                    type="button"
                    className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    onClick={() => setBulkDeleteDialogOpen(true)}
                    disabled={!selectedEntryCount || isBulkDeletingEntries}
                  >
                    Видалити вибрані
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Пошук журналів
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
                      value={journalSearch}
                      onChange={(event) => setJournalSearch(event.target.value)}
                      placeholder="Пошук за номером або назвою журналу"
                    />
                  </label>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Статус
                    <select
                      aria-label="Фільтр за статусом журналів"
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value)}
                    >
                      <option value="">Усі статуси</option>
                      <option value="complete">Розклад і слухачі</option>
                      <option value="schedule_only">Тільки розклад</option>
                      <option value="trainees_only">Тільки слухачі</option>
                      <option value="not_processed">Не опрацьовано</option>
                      <option value="unknown_code">Без номера групи</option>
                      <option value="workload_only">Тільки педнавантаження</option>
                      <option value="with_workload">Є педнавантаження</option>
                      <option value="without_workload">Немає педнавантаження</option>
                    </select>
                  </label>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Розклад
                    <select
                      aria-label="Фільтр за розкладом журналів"
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
                      value={scheduleFilter}
                      onChange={(event) => setScheduleFilter(event.target.value)}
                    >
                      <option value="">Усі</option>
                      <option value="true">Є розклад</option>
                      <option value="false">Немає розкладу</option>
                    </select>
                  </label>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Слухачі
                    <select
                      aria-label="Фільтр за слухачами журналів"
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink"
                      value={traineesFilter}
                      onChange={(event) => setTraineesFilter(event.target.value)}
                    >
                      <option value="">Усі</option>
                      <option value="true">Є слухачі</option>
                      <option value="false">Немає слухачів</option>
                    </select>
                  </label>
                </div>
              </div>
              <div className="overflow-x-auto" data-testid="journal-entries-scroll">
                <table className="min-w-[58rem] w-full text-left text-sm xl:min-w-full">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Вибір</th>
                      <th className="sticky left-0 z-20 bg-slate-50 px-3 py-2 shadow-[1px_0_0_#e2e8f0]">{renderSortButton("group", "Група")}</th>
                      <th className="min-w-[14rem] px-3 py-2">{renderSortButton("journal", "Папка / файли журналів")}</th>
                      <th className="px-2 py-2 whitespace-nowrap">{renderSortButton("status", "Статус")}</th>
                      <th className="px-3 py-2 whitespace-nowrap">{renderSortButton("workload", "Педнавантаження")}</th>
                      <th className="px-3 py-2">Години</th>
                      <th className="px-3 py-2">{renderSortButton("schedule", "Розклад")}</th>
                      <th className="px-3 py-2">{renderSortButton("trainees", "Слухачі")}</th>
                      <th className="px-3 py-2">Занять</th>
                      <th className="px-3 py-2">Осіб</th>
                      <th className="px-3 py-2">Drive</th>
                      <th className="px-3 py-2">Дії</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {visibleRows.map((row: JournalMonitorEntry) => (
                      <tr key={row.id}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={Boolean(selectedEntryIds[row.id])}
                            onChange={() => toggleEntrySelection(row.id)}
                            aria-label={`Вибрати журнал ${row.group_code || row.journal_name}`}
                          />
                        </td>
                        <td
                          className="sticky left-0 z-10 bg-white px-3 py-2 font-semibold text-ink shadow-[1px_0_0_#e2e8f0]"
                          data-testid="journal-group-cell"
                        >
                          {row.group_code || "—"}
                        </td>
                        <td className="min-w-[14rem] px-3 py-2">
                          <div>{row.journal_name}</div>
                          {row.workload_source_names?.length > 0 && (
                            <div className="mt-1 space-y-0.5 text-xs font-medium text-slate-500">
                              {row.workload_source_names.map((sourceName) => (
                                <div key={sourceName}>{sourceName}</div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-1 py-2">
                          <span
                            className={clsx(
                              "inline-block rounded-full px-1.5 py-1 text-xs font-semibold",
                              getDisplayStatus(row) === "workload_only" ? "whitespace-normal text-center leading-tight" : "whitespace-nowrap",
                              STATUS_CLASSES[getDisplayStatus(row)] || STATUS_CLASSES.unknown_code
                            )}
                          >
                            {renderDisplayStatus(row)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {row.workload_status === "no_data" ? (
                            renderNoDataBadge(row.workload_message)
                          ) : (
                            <span
                              className={clsx(
                                "whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold",
                                WORKLOAD_STATUS_CLASSES[row.workload_status] || WORKLOAD_STATUS_CLASSES.pending
                              )}
                              title={getWorkloadStatusTitle(row)}
                            >
                              {formatWorkloadStatus(row.workload_status)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">{renderWorkloadHours(row)}</td>
                        <td className="px-3 py-2">{renderBoolean(row.has_schedule)}</td>
                        <td className="px-3 py-2">{renderTraineesState(row)}</td>
                        <td className="px-3 py-2">{row.schedule_lessons}</td>
                        <td className="px-3 py-2">{renderTraineeCount(row)}</td>
                        <td className="px-3 py-2">
                          {row.drive_url ? (
                            <a className="font-semibold text-pine underline" href={row.drive_url} target="_blank" rel="noreferrer">
                              Відкрити
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="rounded-lg border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                            onClick={() => setEntryToDelete(row)}
                            disabled={isDeletingEntry}
                          >
                            Видалити
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!isLoading && rows.length === 0 && (
                      <tr>
                        <td className="px-3 py-6 text-center text-slate-500" colSpan={12}>
                          Даних ще немає. Натисніть «Оновити» після створення розділу.
                        </td>
                      </tr>
                    )}
                    {!isLoading && rows.length > 0 && visibleRows.length === 0 && (
                      <tr>
                        <td className="px-3 py-6 text-center text-slate-500" colSpan={12}>
                          За цим пошуком журналів не знайдено.
                        </td>
                      </tr>
                    )}
                    {isLoading && (
                      <tr>
                        <td className="px-3 py-6 text-center text-slate-500" colSpan={12}>
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
      <ConfirmDialog
        open={Boolean(entryToDelete)}
        title="Видалити журнал"
        description={`Видалити «${entryToDelete?.group_code || entryToDelete?.journal_name || "цей журнал"}» з моніторингу? Після наступної синхронізації він знов підтягнеться з Google Drive, якщо папка там існує.`}
        confirmLabel={isDeletingEntry ? "Видаляємо..." : "Видалити"}
        confirmDisabled={isDeletingEntry}
        confirmVariant="danger"
        onConfirm={deleteJournalEntry}
        onCancel={() => {
          if (!isDeletingEntry) setEntryToDelete(null);
        }}
      />
      <ConfirmDialog
        open={bulkDeleteDialogOpen}
        title="Видалити вибрані журнали"
        description={`Видалити вибрані журнали (${selectedEntryCount}) з моніторингу? Відповідні групи буде приховано з реєстру груп, але вже імпортовані слухачі та розклад залишаться в базі.`}
        confirmLabel={isBulkDeletingEntries ? "Видаляємо..." : "Видалити"}
        confirmDisabled={isBulkDeletingEntries || !selectedEntryCount}
        confirmVariant="danger"
        onConfirm={bulkDeleteJournalEntries}
        onCancel={() => {
          if (!isBulkDeletingEntries) setBulkDeleteDialogOpen(false);
        }}
      />
    </div>
  );
}
