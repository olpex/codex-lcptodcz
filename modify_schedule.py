import re

with open("frontend/src/pages/SchedulePage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# 1. We don't need DataTable anymore for the Schedule grids
content = content.replace(
    'import { DataTable, type DataTableColumn } from "../components/DataTable";',
    ''
)

# 2. Add shortName helper
short_name_code = """
function shortName(name: string | undefined | null) {
  if (!name) return "—";
  const parts = name.trim().split(/\\s+/);
  if (parts.length === 1) return parts[0];
  if (parts.length >= 3) {
    return `${parts[0]} ${parts[1][0]}.${parts[2][0]}.`;
  }
  return `${parts[0]} ${parts[1][0]}.`;
}
"""
content = content.replace("function toSlotHours(", short_name_code + "\nfunction toSlotHours(")

# 3. Replace slotColumns with MonthCalendar component
month_calendar_code = """
const MonthCalendar = ({ monthKey, slots, conflictAnalysis }: { monthKey: string; slots: ScheduleSlot[]; conflictAnalysis: ConflictAnalysis }) => {
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
            <div key={day} className={`bg-white p-2 min-h-[120px] relative group hover:bg-slate-50 transition-colors ${hasConflicts ? 'bg-red-50/30' : ''}`}>
              <span className={`text-sm font-semibold ${hasConflicts ? 'text-red-600' : 'text-slate-700'}`}>{day}</span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {daySlots.map(slot => {
                  const isConflict = conflictAnalysis.conflictSlotIds.has(slot.id);
                  return (
                    <div 
                      key={slot.id} 
                      className={`w-3 h-3 rounded-full ${isConflict ? 'bg-red-500 shadow-[0_0_0_2px_rgba(239,68,68,0.2)]' : 'bg-pine'}`}
                    />
                  );
                })}
              </div>
              
              {daySlots.length > 0 && (
                <div className="hidden group-hover:block absolute z-20 bottom-[calc(100%-10px)] left-1/2 -translate-x-1/2 mb-2 w-max max-w-[280px] p-2.5 bg-slate-800 text-white text-xs rounded shadow-xl">
                  <div className="font-bold mb-1.5 border-b border-slate-600 pb-1.5">Заняття ({day} число)</div>
                  {daySlots.map(slot => {
                    const isConflict = conflictAnalysis.conflictSlotIds.has(slot.id);
                    return (
                      <div key={slot.id} className={`mb-1.5 last:mb-0 ${isConflict ? 'text-red-300 font-medium' : ''}`}>
                        <span className="opacity-75">Пара {slot.pair_number ?? '-'}:</span> {slot.group_code || slot.group_id} — {shortName(slot.teacher_name)}
                        {isConflict && " ⚠️ Накладка"}
                      </div>
                    );
                  })}
                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
"""

content = re.sub(r'const slotColumns = useMemo<DataTableColumn<ScheduleSlot>\[\]>\([\s\S]*?\[conflictAnalysis\]\n  \);', month_calendar_code, content)

# 4. Modify groupedSchedule to group by Month
grouped_schedule_code = """
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
"""
content = re.sub(r'const groupedSchedule = useMemo\(\(\) => \{[\s\S]*?\[slots, sortDirection\]\);', grouped_schedule_code.strip(), content)

# 5. Replace DataTable inside render
render_calendar_code = """
                    <MonthCalendar monthKey={group.dateKey} slots={group.slots} conflictAnalysis={conflictAnalysis} />
"""
content = re.sub(r'<DataTable[\s\S]*?pageSizeOptions=\{\[10, 20, 50\]\}\n\s*\/>', render_calendar_code.strip(), content)

with open("frontend/src/pages/SchedulePage.tsx", "w", encoding="utf-8") as f:
    f.write(content)

print("SchedulePage updated successfully.")
