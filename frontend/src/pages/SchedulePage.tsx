import { FormEvent, useEffect, useMemo, useState } from "react";

import { FormField, FormSubmitButton, formControlClass } from "../components/FormField";
import { Panel } from "../components/Panel";
import { StickyActionBar } from "../components/StickyActionBar";
import { TrendStatCard } from "../components/TrendStatCard";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import type { ScheduleSlot, Teacher } from "../types/api";

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
type ConflictInterval = {
  slotId: number;
  start: number;
  end: number;
  dateKey: string;
  academicHours?: number | null;
  pairNumber?: number | null;
  groupId?: number;
};

type ConflictAnalysis = {
  overlapCount: number;
  conflictSlotIds: Set<number>;
  conflictSlotCountByDate: Map<string, number>;
};


function shortName(name: string | undefined | null) {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  if (parts.length >= 3) {
    return `${parts[0]} ${parts[1][0]}.${parts[2][0]}.`;
  }
  return `${parts[0]} ${parts[1][0]}.`;
}

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

function detectOverlapsInIntervals(
  intervals: ConflictInterval[],
  conflictSlotIds: Set<number>,
  conflictSlotIdsByDate: Map<string, Set<number>>
): number {
  if (intervals.length < 2) return 0;
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let overlaps = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const left = sorted[index];
    for (let compareIndex = index + 1; compareIndex < sorted.length; compareIndex += 1) {
      const right = sorted[compareIndex];
      if (right.start >= left.end) {
        break;
      }

      // Якщо записи свідомо розміщені в одній парі (наприклад, 1+1 година або об'єднана лекція),
      // ми не вважаємо це накладкою.
      if (
        left.pairNumber != null &&
        left.pairNumber === right.pairNumber
      ) {
        continue;
      }

      overlaps += 1;
      conflictSlotIds.add(left.slotId);
      conflictSlotIds.add(right.slotId);
      const dateSet = conflictSlotIdsByDate.get(left.dateKey) || new Set<number>();
      dateSet.add(left.slotId);
      dateSet.add(right.slotId);
      conflictSlotIdsByDate.set(left.dateKey, dateSet);
    }
  }
  return overlaps;
}

function analyzeScheduleConflicts(slots: ScheduleSlot[]): ConflictAnalysis {
  const teacherMap = new Map<string, ConflictInterval[]>();
  const roomMap = new Map<string, ConflictInterval[]>();

  for (const slot of slots) {
    const start = new Date(slot.starts_at).getTime();
    const end = new Date(slot.ends_at).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    const dateKey = slot.starts_at.slice(0, 10);
    const teacherKey = `${dateKey}:teacher:${slot.teacher_id}`;
    const roomKey = `${dateKey}:room:${slot.room_id}`;
    const interval: ConflictInterval = { 
      slotId: slot.id, 
      start, 
      end, 
      dateKey, 
      academicHours: slot.academic_hours, 
      pairNumber: slot.pair_number,
      groupId: slot.group_id
    };
    teacherMap.set(teacherKey, [...(teacherMap.get(teacherKey) || []), interval]);
    roomMap.set(roomKey, [...(roomMap.get(roomKey) || []), interval]);
  }

  const conflictSlotIds = new Set<number>();
  const conflictSlotIdsByDate = new Map<string, Set<number>>();
  let overlapCount = 0;
  for (const intervals of teacherMap.values()) {
    overlapCount += detectOverlapsInIntervals(intervals, conflictSlotIds, conflictSlotIdsByDate);
  }
  for (const intervals of roomMap.values()) {
    overlapCount += detectOverlapsInIntervals(intervals, conflictSlotIds, conflictSlotIdsByDate);
  }

  const conflictSlotCountByDate = new Map<string, number>();
  for (const [dateKey, ids] of conflictSlotIdsByDate.entries()) {
    conflictSlotCountByDate.set(dateKey, ids.size);
  }

  return {
    overlapCount,
    conflictSlotIds,
    conflictSlotCountByDate
  };
}

const MonthCalendar = ({ 
  monthKey, 
  slots, 
  conflictAnalysis,
  onUpdateSlot 
}: { 
  monthKey: string; 
  slots: ScheduleSlot[]; 
  conflictAnalysis: ConflictAnalysis;
  onUpdateSlot: (id: number, payload: Partial<ScheduleSlot>) => void;
}) => {
  const [yearStr, monthStr] = monthKey.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const slotsByDay = useMemo(() => {
    const map = new Map<number, ScheduleSlot[]>();
    for (const slot of slots) {
      const d = parseInt(slot.starts_at.slice(8, 10), 10);
      const existing = map.get(d) || [];
      existing.push(slot);
      map.set(d, existing);
    }
    return map;
  }, [slots]);

  const conflictGroups = useMemo(() => {
    const map = new Map<string, ScheduleSlot[]>();
    for (const slot of slots) {
      if (conflictAnalysis.conflictSlotIds.has(slot.id)) {
        const key = `${slot.starts_at.slice(0, 10)} (Пара ${slot.pair_number ?? '-'})`;
        const existing = map.get(key) || [];
        existing.push(slot);
        map.set(key, existing);
      }
    }
    return map;
  }, [slots, conflictAnalysis]);

  return (
    <div className="flex flex-col">
      {conflictGroups.size > 0 && (
        <div className="p-4 bg-red-50 border-b border-red-100">
          <h4 className="text-red-800 font-semibold mb-2">⚠ Накладки (співпадіння часу, викладача чи аудиторії):</h4>
          <ul className="text-sm text-red-700 space-y-2">
            {Array.from(conflictGroups.entries()).map(([key, cSlots]) => (
              <li key={key}>
                <strong>{key}:</strong>
                <ul className="list-disc pl-5 mt-1 text-red-600">
                  {cSlots.map(s => (
                    <li key={s.id}>Група {s.group_code || s.group_id}, Викладач: {shortName(s.teacher_name)}, Ауд: {s.room_name || s.room_id || "—"}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid grid-cols-7 gap-px bg-slate-200">
        {["Пн", "Вв", "Ср", "Чт", "Пт", "Сб", "Нд"].map(d => (
          <div key={d} className="bg-slate-100 p-2 text-center text-xs font-semibold text-slate-600 uppercase">{d}</div>
        ))}
        {Array.from({ length: startOffset }).map((_, i) => (
          <div key={`empty-${i}`} className="bg-slate-50 min-h-[120px]" />
        ))}
        {days.map(day => {
          const daySlots = slotsByDay.get(day) || [];
          daySlots.sort((a, b) => (a.pair_number ?? 999) - (b.pair_number ?? 999));
          const hasConflicts = daySlots.some(s => conflictAnalysis.conflictSlotIds.has(s.id));
          
          return (
            <div 
              key={day} 
              className={`bg-white p-2 min-h-[120px] relative group hover:bg-slate-50 transition-colors ${hasConflicts ? 'bg-red-50/30' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                e.currentTarget.classList.add('bg-blue-50');
              }}
              onDragLeave={(e) => {
                e.currentTarget.classList.remove('bg-blue-50');
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('bg-blue-50');
                const dataStr = e.dataTransfer.getData('application/json');
                if (!dataStr) return;
                try {
                  const data = JSON.parse(dataStr);
                  const targetDate = `${monthKey}-${day.toString().padStart(2, '0')}`;
                  
                  if (data.type === 'slot') {
                    // Update slot date and keep its time by merging with new date
                    const slotIds: number[] = data.slotIds;
                    slotIds.forEach(id => {
                      const existingSlot = slots.find(s => s.id === id);
                      if (existingSlot) {
                        const newStartsAt = `${targetDate}T${existingSlot.starts_at.split('T')[1]}`;
                        const newEndsAt = `${targetDate}T${existingSlot.ends_at.split('T')[1]}`;
                        onUpdateSlot(id, { starts_at: newStartsAt, ends_at: newEndsAt });
                      }
                    });
                  }
                } catch (err) {
                  console.error(err);
                }
              }}
            >
              <span className={`text-sm font-semibold ${hasConflicts ? 'text-red-600' : 'text-slate-700'}`}>{day}</span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {
                  // Групуємо слоти, якщо вони мають однакову пару, викладача і по 1 годині
                  Object.values(
                    daySlots.reduce((acc, slot) => {
                      const isConflict = conflictAnalysis.conflictSlotIds.has(slot.id);
                      if (slot.pair_number != null && slot.academic_hours === 1 && !isConflict) {
                        const key = `pair:${slot.pair_number}:teacher:${slot.teacher_id}`;
                        if (!acc[key]) acc[key] = [];
                        acc[key].push(slot);
                      } else {
                        acc[`slot:${slot.id}`] = [slot];
                      }
                      return acc;
                    }, {} as Record<string, ScheduleSlot[]>)
                  ).map(group => {
                    const first = group[0];
                    const isConflict = conflictAnalysis.conflictSlotIds.has(first.id);
                    return (
                      <div 
                        key={group.map(s => s.id).join('-')} 
                        draggable
                        onDragStart={(e) => {
                          e.stopPropagation();
                          e.dataTransfer.setData('application/json', JSON.stringify({ type: 'slot', slotIds: group.map(s => s.id) }));
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          e.currentTarget.classList.add('opacity-50');
                        }}
                        onDragLeave={(e) => {
                          e.currentTarget.classList.remove('opacity-50');
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          e.currentTarget.classList.remove('opacity-50');
                          const dataStr = e.dataTransfer.getData('application/json');
                          if (!dataStr) return;
                          try {
                            const data = JSON.parse(dataStr);
                            if (data.type === 'teacher') {
                              const teacherId = data.teacherId;
                              group.forEach(s => {
                                onUpdateSlot(s.id, { teacher_id: teacherId });
                              });
                            }
                          } catch (err) {
                            console.error(err);
                          }
                        }}
                        className={`text-[10px] p-1 mb-1 rounded cursor-grab border ${isConflict ? 'bg-red-100 border-red-300 text-red-800' : 'bg-green-50 border-green-200 text-green-800'}`}
                      >
                        <div className="font-semibold">Пара {first.pair_number}</div>
                        <div className="truncate">{shortName(first.teacher_name)}</div>
                        <div className="truncate text-[9px] opacity-80">{group.map(s => s.group_code || s.group_id).join(', ')}</div>
                      </div>
                    );
                  })
                }
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export function SchedulePage() {
  const { request, user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [statsHistory, setStatsHistory] = useState<ScheduleSnapshot[]>([]);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [days, setDays] = useState(5);
  const [generateErrors, setGenerateErrors] = useState<{ startDate?: string; days?: string }>({});
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [showConflictsOnly, setShowConflictsOnly] = useState(false);
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const canGenerate = user?.roles.some((role) => role.name === "admin" || role.name === "methodist") ?? false;

  const appendSnapshot = (data: ScheduleSlot[]) => {
    const totalHours = Number(data.reduce((acc, slot) => acc + toSlotHours(slot), 0).toFixed(1));
    const uniqueGroups = new Set(data.map((slot) => slot.group_id)).size;
    const uniqueTeachers = new Set(data.map((slot) => slot.teacher_id)).size;
    const conflicts = analyzeScheduleConflicts(data).overlapCount;
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

  const conflictAnalysis = useMemo(() => analyzeScheduleConflicts(slots), [slots]);

  const fetchSchedule = async () => {
    setIsLoading(true);
    try {
      const [data, teachersData] = await Promise.all([
        request<ScheduleSlot[]>("/schedule"),
        request<Teacher[]>("/teachers")
      ]);
      
      // Temporary cleanup for phantom/invalid teachers
      const invalidTeachers = teachersData.filter(t => t.last_name === 'Сидоренко' || t.last_name === 'Коваль');
      if (invalidTeachers.length > 0) {
        await Promise.all(invalidTeachers.map(t => request(`/teachers/${t.id}`, { method: 'DELETE' }).catch(console.error)));
      }
      
      const validTeachers = teachersData.filter(t => t.last_name !== 'Сидоренко' && t.last_name !== 'Коваль');
      
      setSlots(data);
      setTeachers(validTeachers);
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

  
  const handleUpdateSlot = async (slotId: number, payload: Partial<ScheduleSlot>) => {
    try {
      const updated = await request<ScheduleSlot>(`/schedule/${slotId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      setSlots(prev => {
        const next = prev.map(s => s.id === slotId ? updated : s);
        appendSnapshot(next);
        return next;
      });
      // showSuccess("Розклад оновлено"); // Removed to prevent annoying toast on drag-and-drop
    } catch (err) {
      showError((err as Error).message);
    }
  };

  useEffect(() => {
    fetchSchedule();
    // Auto-refresh every 30 s so background mail imports appear without a
    // manual click (e.g. after re-importing a schedule that had a deleted teacher).
    const intervalId = setInterval(() => {
      fetchSchedule();
    }, 30_000);
    return () => clearInterval(intervalId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const groupedSchedule = useMemo(() => {
    const grouped = new Map<string, ScheduleSlot[]>();
    for (const slot of slots) {
      const monthKey = slot.starts_at.slice(0, 7);
      grouped.set(monthKey, [...(grouped.get(monthKey) || []), slot]);
    }

    const result: GroupedSchedule[] = [];
    for (const [monthKey, daySlots] of grouped.entries()) {
      const sortedSlots = [...daySlots].sort((a, b) => {
        const pairA = a.pair_number ?? 999;
        const pairB = b.pair_number ?? 999;
        if (pairA !== pairB) return pairA - pairB;
        return a.starts_at.localeCompare(b.starts_at);
      });
      const label = new Date(`${monthKey}-01T00:00:00Z`).toLocaleDateString("uk-UA", {
        month: "long",
        year: "numeric"
      });
      const totalHours = sortedSlots.reduce((acc, slot) => acc + (slot.academic_hours ?? 0), 0);
      result.push({ dateKey: monthKey, label, slots: sortedSlots, totalHours: Number(totalHours.toFixed(2)) });
    }

    return result.sort((a, b) =>
      sortDirection === "asc" ? a.dateKey.localeCompare(b.dateKey) : b.dateKey.localeCompare(a.dateKey)
    );
  }, [slots, sortDirection]);

  const visibleGroupedSchedule = useMemo(() => {
    if (!showConflictsOnly) {
      return groupedSchedule;
    }
    return groupedSchedule
      .map((group) => {
        const conflictSlots = group.slots.filter((slot) => conflictAnalysis.conflictSlotIds.has(slot.id));
        const totalHours = conflictSlots.reduce((acc, slot) => acc + (slot.academic_hours ?? 0), 0);
        return { ...group, slots: conflictSlots, totalHours: Number(totalHours.toFixed(2)) };
      })
      .filter((group) => group.slots.length > 0);
  }, [groupedSchedule, showConflictsOnly, conflictAnalysis.conflictSlotIds]);

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
    if (!visibleGroupedSchedule.length) {
      setExpandedDates({});
      return;
    }
    const allowedDates = new Set(visibleGroupedSchedule.map((group) => group.dateKey));
    setExpandedDates((prev) => {
      const filteredEntries = Object.entries(prev).filter(([key]) => allowedDates.has(key));
      const filteredState = Object.fromEntries(filteredEntries) as Record<string, boolean>;
      const hasExpanded = Object.values(filteredState).some(Boolean);
      if (hasExpanded) {
        return filteredState;
      }
      return { ...filteredState, [visibleGroupedSchedule[0].dateKey]: true };
    });
  }, [visibleGroupedSchedule]);

  const toggleDate = (dateKey: string) => {
    setExpandedDates((prev) => ({ ...prev, [dateKey]: !prev[dateKey] }));
  };

  const expandAll = () => {
    const nextState = Object.fromEntries(visibleGroupedSchedule.map((group) => [group.dateKey, true]));
    setExpandedDates(nextState);
  };

  const collapseAll = () => {
    setExpandedDates({});
  };

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    if (!canGenerate || isGenerating) return;
    const nextErrors: { startDate?: string; days?: string } = {};
    if (!startDate) {
      nextErrors.startDate = "Вкажіть дату старту";
    }
    if (!Number.isInteger(days) || days < 1 || days > 30) {
      nextErrors.days = "Кількість днів має бути цілим числом від 1 до 30";
    }
    if (Object.keys(nextErrors).length) {
      setGenerateErrors(nextErrors);
      showError(Object.values(nextErrors)[0]);
      return;
    }

    setGenerateErrors({});
    setIsGenerating(true);
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
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-5">
      {canGenerate && (
        <Panel title="Генерація розкладу">
          <form className="flex flex-wrap items-end gap-3" onSubmit={generate}>
            <FormField
              label="Дата старту"
              required
              helperText="Дата першого дня генерації"
              errorText={generateErrors.startDate}
            >
              <input
                type="date"
                className={formControlClass}
                value={startDate}
                onChange={(event) => {
                  setStartDate(event.target.value);
                  setGenerateErrors((prev) => ({ ...prev, startDate: undefined }));
                }}
                required
              />
            </FormField>
            <FormField label="Кількість днів" required helperText="Від 1 до 30" errorText={generateErrors.days}>
              <input
                type="number"
                min={1}
                max={30}
                className={formControlClass}
                value={days}
                onChange={(event) => {
                  setDays(Number(event.target.value));
                  setGenerateErrors((prev) => ({ ...prev, days: undefined }));
                }}
                required
              />
            </FormField>
            <FormSubmitButton
              isLoading={isGenerating}
              idleLabel="Згенерувати"
              loadingLabel="Генеруємо..."
              className="rounded-lg bg-pine px-4 py-2 font-semibold text-white"
            />
          </form>
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
        <StickyActionBar className="mb-3">
          <div className="flex flex-wrap items-center gap-3">
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
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={showConflictsOnly}
              onChange={(event) => setShowConflictsOnly(event.target.checked)}
            />
            Лише конфлікти
          </label>
          </div>
        </StickyActionBar>
        {conflictAnalysis.overlapCount > 0 && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Виявлено конфлікти у розкладі: {conflictAnalysis.overlapCount}. Конфліктні рядки підсвічено нижче.
          </div>
        )}
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

        {!visibleGroupedSchedule.length && (
          <p className="text-sm text-slate-600">
            {showConflictsOnly ? "Конфліктних занять не знайдено." : "Занять у розкладі поки немає."}
          </p>
        )}

        <div className="flex flex-col xl:flex-row gap-5">
          <div className="flex-1 space-y-3">
            {visibleGroupedSchedule.map((group) => {
              const isExpanded = Boolean(expandedDates[group.dateKey]);
              const dayConflictCount = conflictAnalysis.conflictSlotCountByDate.get(group.dateKey) || 0;
              return (
                <div key={group.dateKey} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <button
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
                    onClick={() => toggleDate(group.dateKey)}
                    aria-expanded={isExpanded}
                    aria-controls={`schedule-day-${group.dateKey}`}
                  >
                    <div>
                      <p className="font-semibold capitalize text-ink">{group.label}</p>
                      <p className="text-xs text-slate-600">
                        Занять: {group.slots.length} | Годин: {group.totalHours}
                        {dayConflictCount > 0 ? ` | Конфліктних: ${dayConflictCount}` : ""}{" "}
                        {dayConflictCount > 0 && (
                          <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">⚠ Увага</span>
                        )}
                      </p>
                    </div>
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-pine text-lg font-bold text-white">
                      {isExpanded ? "−" : "+"}
                    </span>
                  </button>

                  {isExpanded && (
                    <div id={`schedule-day-${group.dateKey}`} className="border-t border-slate-200 px-3 py-2">
                      <MonthCalendar monthKey={group.dateKey} slots={group.slots} conflictAnalysis={conflictAnalysis} onUpdateSlot={handleUpdateSlot} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          
          {canGenerate && teachers.length > 0 && (
            <div className="w-full xl:w-64 flex-shrink-0">
              <div className="sticky top-[140px] rounded-xl border border-slate-200 bg-white p-3 shadow-sm max-h-[calc(100vh-160px)] overflow-y-auto">
                <h4 className="font-semibold text-slate-800 mb-2">Викладачі</h4>
                <p className="text-xs text-slate-500 mb-3">Перетягніть викладача на заняття для заміни.</p>
                <div className="space-y-1.5">
                  {teachers.map(t => (
                    <div
                      key={t.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/json', JSON.stringify({ type: 'teacher', teacherId: t.id }));
                      }}
                      className="text-sm p-2 rounded border border-slate-200 bg-slate-50 cursor-grab hover:bg-slate-100"
                    >
                      {t.last_name} {t.first_name}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
