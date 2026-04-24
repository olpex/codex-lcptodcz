import { useEffect, useMemo, useState } from "react";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import type { ScheduleSlot } from "../types/api";

type GroupedSchedule = {
  dateKey: string;
  label: string;
  slots: ScheduleSlot[];
  totalHours: number;
};

export function SchedulePage() {
  const { request, user } = useAuth();
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [days, setDays] = useState(5);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");

  const canGenerate = user?.roles.some((role) => role.name === "admin" || role.name === "methodist") ?? false;

  const fetchSchedule = async () => {
    setError("");
    try {
      const data = await request<ScheduleSlot[]>("/schedule");
      setSlots(data);
    } catch (e) {
      setError((e as Error).message);
    }
  };

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
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {canGenerate && (
        <Panel title="Генерація розкладу">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="date"
              className="rounded-lg border border-slate-300 px-3 py-2"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
            <input
              type="number"
              min={1}
              max={30}
              className="w-24 rounded-lg border border-slate-300 px-3 py-2"
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            />
            <button className="rounded-lg bg-pine px-4 py-2 font-semibold text-white" onClick={generate}>
              Згенерувати
            </button>
          </div>
        </Panel>
      )}
      <Panel title="Поточний розклад">
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
                    <div className="overflow-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-slate-600">
                            <th className="px-2 py-2">Пара</th>
                            <th className="px-2 py-2">Час</th>
                            <th className="px-2 py-2">Група</th>
                            <th className="px-2 py-2">Предмет</th>
                            <th className="px-2 py-2">Викладач</th>
                            <th className="px-2 py-2">Год.</th>
                            <th className="px-2 py-2">Аудиторія</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.slots.map((slot) => (
                            <tr key={slot.id} className="border-b border-slate-100">
                              <td className="px-2 py-2">{slot.pair_number ?? "—"}</td>
                              <td className="px-2 py-2">
                                {new Date(slot.starts_at).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })} -{" "}
                                {new Date(slot.ends_at).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}
                              </td>
                              <td className="px-2 py-2">
                                {slot.group_code ? `${slot.group_code} (${slot.group_name || ""})` : slot.group_id}
                              </td>
                              <td className="px-2 py-2">{slot.subject_name || slot.subject_id}</td>
                              <td className="px-2 py-2">{slot.teacher_name || slot.teacher_id}</td>
                              <td className="px-2 py-2">{slot.academic_hours ?? "—"}</td>
                              <td className="px-2 py-2">{slot.room_name || slot.room_id}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
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
