import { useEffect, useMemo, useState } from "react";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { FormField, formControlClass } from "../components/FormField";
import { Panel } from "../components/Panel";
import { TrendStatCard } from "../components/TrendStatCard";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import type { ScheduleSlot } from "../types/api";

type GroupedSchedule = {
  dateKey: string;
  label: string;
  slots: ScheduleSlot[];
  totalHours: number;
};

type ScheduleSnapshot = {
  totalLessons: number;
  totalHours: number;
  uniqueGroups: number;
  uniqueTeachers: number;
  conflicts: number;
};

const STATS_HISTORY_LIMIT = 12;

function toSlotHours(slot: ScheduleSlot): number {
  if (typeof slot.academic_hours === "number" && Number.isFinite(slot.academic_hours)) {
    return slot.academic_hours;
  }
  const starts = new Date(slot.starts_at).getTime();
  const ends = new Date(slot.ends_at).getTime();
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts) {
    return 0;
  }
  return (ends - starts) / 3_600_000;
}

function countOverlapInIntervals(intervals: Array<{ start: number; end: number }>): number {
  if (intervals.length < 2) return 0;
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let overlaps = 0;
  let currentEnd = sorted[0].end;
  for (let index = 1; index < sorted.length; index += 1) {
    const next = sorted[index];
    if (next.start < currentEnd) {
      overlaps += 1;
      currentEnd = Math.max(currentEnd, next.end);
    } else {
      currentEnd = next.end;
    }
  }
  return overlaps;
}

function countScheduleConflicts(slots: ScheduleSlot[]): number {
  const teacherMap = new Map<string, Array<{ start: number; end: number }>>();
  const roomMap = new Map<string, Array<{ start: number; end: number }>>();

  for (const slot of slots) {
    const start = new Date(slot.starts_at).getTime();
    const end = new Date(slot.ends_at).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    const dateKey = slot.starts_at.slice(0, 10);
    const teacherKey = `${dateKey}:teacher:${slot.teacher_id}`;
    const roomKey = `${dateKey}:room:${slot.room_id}`;
    teacherMap.set(teacherKey, [...(teacherMap.get(teacherKey) || []), { start, end }]);
    roomMap.set(roomKey, [...(roomMap.get(roomKey) || []), { start, end }]);
  }

  let overlaps = 0;
  for (const intervals of teacherMap.values()) {
    overlaps += countOverlapInIntervals(intervals);
  }
  for (const intervals of roomMap.values()) {
    overlaps += countOverlapInIntervals(intervals);
  }
  return overlaps;
}

export function SchedulePage() {
  const { request, user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [statsHistory, setStatsHistory] = useState<ScheduleSnapshot[]>([]);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [days, setDays] = useState(5);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const canGenerate = user?.roles.some((role) => role.name === "admin" || role.name === "methodist") ?? false;

  const appendSnapshot = (data: ScheduleSlot[]) => {
    const totalHours = Number(data.reduce((acc, slot) => acc + toSlotHours(slot), 0).toFixed(1));
    const uniqueGroups = new Set(data.map((slot) => slot.group_id)).size;
    const uniqueTeachers = new Set(data.map((slot) => slot.teacher_id)).size;
    const conflicts = countScheduleConflicts(data);
    const snapshot: ScheduleSnapshot = {
      totalLessons: data.length,
      totalHours,
      uniqueGroups,
      uniqueTeachers,
      conflicts
    };
    setStatsHistory((prev) => {
      const next = [...prev, snapshot];
      if (next.length <= STATS_HISTORY_LIMIT) return next;
      return next.slice(next.length - STATS_HISTORY_LIMIT);
    });
  };

  const fetchSchedule = async () => {
    setIsLoading(true);
    try {
      const data = await request<ScheduleSlot[]>("/schedule");
      setSlots(data);
      appendSnapshot(data);
      setLoadError(null);
    } catch (error) {
      const message = (error as Error).message;
      setLoadError(message);
      showError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const slotColumns = useMemo<DataTableColumn<ScheduleSlot>[]>(
    () => [
      {
        key: "pair",
        header: "Пара",
        render: (slot) => slot.pair_number ?? "—",
        sortAccessor: (slot) => slot.pair_number ?? 999
      },
      {
        key: "time",
        header: "Час",
        render: (slot) =>
          `${new Date(slot.starts_at).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })} - ${new Date(
            slot.ends_at
          ).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}`,
        sortAccessor: (slot) => slot.starts_at
      },
      {
        key: "group",
        header: "Група",
        render: (slot) => (slot.group_code ? `${slot.group_code} (${slot.group_name || ""})` : slot.group_id),
        sortAccessor: (slot) => slot.group_code || slot.group_name || String(slot.group_id)
      },
      {
        key: "subject",
        header: "Предмет",
        render: (slot) => slot.subject_name || slot.subject_id,
        sortAccessor: (slot) => slot.subject_name || String(slot.subject_id)
      },
      {
        key: "teacher",
        header: "Викладач",
        render: (slot) => slot.teacher_name || slot.teacher_id,
        sortAccessor: (slot) => slot.teacher_name || String(slot.teacher_id)
      },
      {
        key: "hours",
        header: "Год.",
        render: (slot) => slot.academic_hours ?? "—",
        sortAccessor: (slot) => slot.academic_hours ?? 0
      },
      {
        key: "room",
        header: "Аудиторія",
        render: (slot) => slot.room_name || slot.room_id,
        sortAccessor: (slot) => slot.room_name || String(slot.room_id)
      }
    ],
    []
  );

  useEffect(() => {
    fetchSchedule();
  }, []);

  const groupedSchedule = useMemo(() => {
    const grouped = new Map<string, ScheduleSlot[]>();
    for (const slot of slots) {
      const dateKey = slot.starts_at.slice(0, 10);
      grouped.set(dateKey, [...(grouped.get(dateKey) || []), slot]);
    }

    const result: GroupedSchedule[] = [];
    for (const [dateKey, daySlots] of grouped.entries()) {
      const sortedSlots = [...daySlots].sort((a, b) => {
        const pairA = a.pair_number ?? 999;
        const pairB = b.pair_number ?? 999;
        if (pairA !== pairB) return pairA - pairB;
        return a.starts_at.localeCompare(b.starts_at);
      });
      const label = new Date(`${dateKey}T00:00:00Z`).toLocaleDateString("uk-UA", {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      });
      const totalHours = sortedSlots.reduce((acc, slot) => acc + (slot.academic_hours ?? 0), 0);
      result.push({ dateKey, label, slots: sortedSlots, totalHours: Number(totalHours.toFixed(2)) });
    }

    return result.sort((a, b) =>
      sortDirection === "asc" ? a.dateKey.localeCompare(b.dateKey) : b.dateKey.localeCompare(a.dateKey)
    );
  }, [slots, sortDirection]);

  const seriesByKey = useMemo(
    () => ({
      totalLessons: statsHistory.map((item) => item.totalLessons),
      totalHours: statsHistory.map((item) => item.totalHours),
      uniqueGroups: statsHistory.map((item) => item.uniqueGroups),
      uniqueTeachers: statsHistory.map((item) => item.uniqueTeachers),
      conflicts: statsHistory.map((item) => item.conflicts)
    }),
    [statsHistory]
  );

  useEffect(() => {
    if (!groupedSchedule.length) {
      setExpandedDates({});
      return;
    }
    const hasExpanded = Object.values(expandedDates).some(Boolean);
    if (!hasExpanded) {
      setExpandedDates({ [groupedSchedule[0].dateKey]: true });
    }
  }, [groupedSchedule]);

  const toggleDate = (dateKey: string) => {
    setExpandedDates((prev) => ({ ...prev, [dateKey]: !prev[dateKey] }));
  };

  const expandAll = () => {
    const nextState = Object.fromEntries(groupedSchedule.map((group) => [group.dateKey, true]));
    setExpandedDates(nextState);
  };

  const collapseAll = () => {
    setExpandedDates({});
  };

  const generate = async () => {
    if (!canGenerate) return;
    try {
      await request<ScheduleSlot[]>("/schedule/generate", {
        method: "POST",
        body: JSON.stringify({
          start_date: startDate,
          days
        })
      });
      await fetchSchedule();
      showSuccess("Розклад успішно згенеровано");
    } catch (error) {
      showError((error as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      {canGenerate && (
        <Panel title="Генерація розкладу">
          <div className="flex flex-wrap items-center gap-3">
            <FormField label="Дата старту">
              <input
                type="date"
                className={formControlClass}
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </FormField>
            <FormField label="Кількість днів" helperText="Від 1 до 30">
              <input
                type="number"
                min={1}
                max={30}
                className={formControlClass}
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
              />
            </FormField>
            <button className="rounded-lg bg-pine px-4 py-2 font-semibold text-white" onClick={generate}>
              Згенерувати
            </button>
          </div>
        </Panel>
      )}
      <Panel title="Поточний розклад">
        <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          {[
            { key: "totalLessons", title: "Заплановані заняття", series: seriesByKey.totalLessons, suffix: "" },
            { key: "totalHours", title: "Навчальні години", series: seriesByKey.totalHours, suffix: " год" },
            { key: "uniqueGroups", title: "Унікальні групи", series: seriesByKey.uniqueGroups, suffix: "" },
            { key: "uniqueTeachers", title: "Унікальні викладачі", series: seriesByKey.uniqueTeachers, suffix: "" },
            { key: "conflicts", title: "Конфлікти (викл./ауд.)", series: seriesByKey.conflicts, suffix: "" }
          ].map((item) => {
            const current = item.series.length ? item.series[item.series.length - 1] : 0;
            const previous = item.series.length > 1 ? item.series[item.series.length - 2] : null;
            const delta = previous == null ? null : Number((current - previous).toFixed(1));
            const valueLabel = `${current.toLocaleString("uk-UA")}${item.suffix}`;
            return (
              <TrendStatCard
                key={item.key}
                title={item.title}
                valueLabel={valueLabel}
                delta={delta}
                deltaSuffix={item.suffix}
                series={item.series}
                sparklineLabel={`${item.title}: тренд за останні оновлення`}
              />
            );
          })}
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <button className="rounded-lg bg-pine px-4 py-2 font-semibold text-white" onClick={fetchSchedule}>
            Оновити
          </button>
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={sortDirection}
            onChange={(event) => setSortDirection(event.target.value as "asc" | "desc")}
          >
            <option value="asc">Сортування: від ранніх дат</option>
            <option value="desc">Сортування: від пізніх дат</option>
          </select>
          <button className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-800" onClick={expandAll}>
            Розгорнути все
          </button>
          <button className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-800" onClick={collapseAll}>
            Згорнути все
          </button>
        </div>
        {loadError && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
            <p className="text-sm text-red-700">{loadError}</p>
            <button
              type="button"
              className="rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-700"
              onClick={fetchSchedule}
            >
              Повторити
            </button>
          </div>
        )}

        {!groupedSchedule.length && <p className="text-sm text-slate-600">Занять у розкладі поки немає.</p>}

        <div className="space-y-3">
          {groupedSchedule.map((group) => {
            const isExpanded = Boolean(expandedDates[group.dateKey]);
            return (
              <div key={group.dateKey} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <button
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
                  onClick={() => toggleDate(group.dateKey)}
                >
                  <div>
                    <p className="font-semibold capitalize text-ink">{group.label}</p>
                    <p className="text-xs text-slate-600">
                      Занять: {group.slots.length} | Годин: {group.totalHours}
                    </p>
                  </div>
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-pine text-lg font-bold text-white">
                    {isExpanded ? "−" : "+"}
                  </span>
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-200 px-3 py-2">
                    <DataTable
                      data={group.slots}
                      columns={slotColumns}
                      rowKey={(slot) => slot.id}
                      isLoading={isLoading}
                      emptyText="Занять за цю дату немає"
                      initialPageSize={20}
                      pageSizeOptions={[10, 20, 50]}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
