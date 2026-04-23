import { useEffect, useState } from "react";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import type { ScheduleSlot } from "../types/api";

export function SchedulePage() {
  const { request, user } = useAuth();
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [days, setDays] = useState(5);
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
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-600">
                <th className="px-2 py-2">Група</th>
                <th className="px-2 py-2">Викладач</th>
                <th className="px-2 py-2">Предмет</th>
                <th className="px-2 py-2">Аудиторія</th>
                <th className="px-2 py-2">Початок</th>
                <th className="px-2 py-2">Кінець</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => (
                <tr key={slot.id} className="border-b border-slate-100">
                  <td className="px-2 py-2">{slot.group_id}</td>
                  <td className="px-2 py-2">{slot.teacher_id}</td>
                  <td className="px-2 py-2">{slot.subject_id}</td>
                  <td className="px-2 py-2">{slot.room_id}</td>
                  <td className="px-2 py-2">{new Date(slot.starts_at).toLocaleString("uk-UA")}</td>
                  <td className="px-2 py-2">{new Date(slot.ends_at).toLocaleString("uk-UA")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

