import { FormEvent, useEffect, useMemo, useState } from "react";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import type { Group, Performance, Trainee } from "../types/api";

type PerformancePayload = {
  trainee_id: number;
  group_id: number;
  progress_pct: number;
  attendance_pct: number;
  employment_flag: boolean;
};

const DEFAULT_FORM: PerformancePayload = {
  trainee_id: 0,
  group_id: 0,
  progress_pct: 0,
  attendance_pct: 0,
  employment_flag: false
};

export function PerformancePage() {
  const { request, user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [rows, setRows] = useState<Performance[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [form, setForm] = useState<PerformancePayload>(DEFAULT_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);

  const canDelete = useMemo(
    () => user?.roles.some((role) => role.name === "admin" || role.name === "methodist") ?? false,
    [user]
  );

  const load = async () => {
    try {
      const [performanceRows, groupRows, traineeRows] = await Promise.all([
        request<Performance[]>("/performance"),
        request<Group[]>("/groups"),
        request<Trainee[]>("/trainees")
      ]);
      setRows(performanceRows);
      setGroups(groupRows);
      setTrainees(traineeRows);
    } catch (error) {
      showError((error as Error).message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      ...form,
      trainee_id: Number(form.trainee_id),
      group_id: Number(form.group_id),
      progress_pct: Number(form.progress_pct),
      attendance_pct: Number(form.attendance_pct)
    };
    if (!payload.trainee_id || !payload.group_id) {
      showError("Оберіть слухача та групу");
      return;
    }
    try {
      if (editingId) {
        await request<Performance>(`/performance/${editingId}`, {
          method: "PUT",
          body: JSON.stringify({
            progress_pct: payload.progress_pct,
            attendance_pct: payload.attendance_pct,
            employment_flag: payload.employment_flag
          })
        });
        showSuccess("Запис успішності оновлено");
      } else {
        await request<Performance>("/performance", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        showSuccess("Запис успішності створено");
      }
      setForm(DEFAULT_FORM);
      setEditingId(null);
      await load();
    } catch (error) {
      showError((error as Error).message);
    }
  };

  const startEdit = (item: Performance) => {
    setEditingId(item.id);
    setForm({
      trainee_id: item.trainee_id,
      group_id: item.group_id,
      progress_pct: item.progress_pct,
      attendance_pct: item.attendance_pct,
      employment_flag: item.employment_flag
    });
  };

  const remove = async (id: number) => {
    try {
      await request<void>(`/performance/${id}`, { method: "DELETE" });
      showSuccess("Запис видалено");
      if (editingId === id) {
        setEditingId(null);
        setForm(DEFAULT_FORM);
      }
      await load();
    } catch (error) {
      showError((error as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      <Panel title={editingId ? "Редагування успішності" : "Нова оцінка успішності"}>
        <form className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" onSubmit={submit}>
          <select
            className="rounded-lg border border-slate-300 px-3 py-2"
            value={form.group_id || ""}
            onChange={(event) => setForm((prev) => ({ ...prev, group_id: Number(event.target.value) }))}
            required
            disabled={Boolean(editingId)}
          >
            <option value="">Оберіть групу</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.code} - {group.name}
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-slate-300 px-3 py-2"
            value={form.trainee_id || ""}
            onChange={(event) => setForm((prev) => ({ ...prev, trainee_id: Number(event.target.value) }))}
            required
            disabled={Boolean(editingId)}
          >
            <option value="">Оберіть слухача</option>
            {trainees.map((trainee) => (
              <option key={trainee.id} value={trainee.id}>
                {trainee.last_name} {trainee.first_name}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            className="rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Прогрес, %"
            value={form.progress_pct}
            onChange={(event) => setForm((prev) => ({ ...prev, progress_pct: Number(event.target.value) }))}
            required
          />
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            className="rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Відвідуваність, %"
            value={form.attendance_pct}
            onChange={(event) => setForm((prev) => ({ ...prev, attendance_pct: Number(event.target.value) }))}
            required
          />
          <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2">
            <input
              type="checkbox"
              checked={form.employment_flag}
              onChange={(event) => setForm((prev) => ({ ...prev, employment_flag: event.target.checked }))}
            />
            Працевлаштований
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button className="rounded-lg bg-pine px-4 py-2 font-semibold text-white">
              {editingId ? "Оновити" : "Створити"}
            </button>
            {editingId && (
              <button
                type="button"
                className="rounded-lg bg-slate-200 px-4 py-2 font-semibold text-slate-800"
                onClick={() => {
                  setEditingId(null);
                  setForm(DEFAULT_FORM);
                }}
              >
                Скасувати
              </button>
            )}
          </div>
        </form>
      </Panel>

      <Panel title="Моніторинг успішності">
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-600">
                <th className="px-2 py-2">ID</th>
                <th className="px-2 py-2">Група</th>
                <th className="px-2 py-2">Слухач</th>
                <th className="px-2 py-2">Прогрес</th>
                <th className="px-2 py-2">Відвідування</th>
                <th className="px-2 py-2">Працевлаштування</th>
                <th className="px-2 py-2">Дії</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id} className="border-b border-slate-100">
                  <td className="px-2 py-2">{item.id}</td>
                  <td className="px-2 py-2">{item.group_id}</td>
                  <td className="px-2 py-2">{item.trainee_id}</td>
                  <td className="px-2 py-2">{item.progress_pct}%</td>
                  <td className="px-2 py-2">{item.attendance_pct}%</td>
                  <td className="px-2 py-2">{item.employment_flag ? "Так" : "Ні"}</td>
                  <td className="px-2 py-2">
                    <div className="flex gap-2">
                      <button className="rounded bg-amber px-2 py-1 text-xs font-semibold text-ink" onClick={() => startEdit(item)}>
                        Редагувати
                      </button>
                      {canDelete && (
                        <button
                          className="rounded bg-red-100 px-2 py-1 text-xs font-semibold text-red-700"
                          onClick={() => remove(item.id)}
                        >
                          Видалити
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
