import { useEffect, useState } from "react";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import type { Workload } from "../types/api";

export function WorkloadPage() {
  const { request, user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [rows, setRows] = useState<Workload[]>([]);
  const [annualLoadDrafts, setAnnualLoadDrafts] = useState<Record<number, string>>({});
  const canEditAnnualLoad =
    user?.roles.some((role) => role.name === "admin" || role.name === "methodist") ?? false;

  const load = async () => {
    try {
      const data = await request<Workload[]>("/teacher-workload");
      setRows(data);
      setAnnualLoadDrafts(
        Object.fromEntries(data.map((row) => [row.teacher_id, String(row.annual_load_hours ?? 0)]))
      );
    } catch (error) {
      showError((error as Error).message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const saveAnnualLoad = async (teacherId: number) => {
    const draftValue = annualLoadDrafts[teacherId];
    const value = Number(draftValue);
    if (!Number.isFinite(value) || value < 0) {
      showError("Річне педнавантаження має бути невід'ємним числом");
      return;
    }
    try {
      await request(`/teachers/${teacherId}`, {
        method: "PUT",
        body: JSON.stringify({ annual_load_hours: value })
      });
      showSuccess("Річне педнавантаження оновлено");
      await load();
    } catch (error) {
      showError((error as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      <Panel title="Навантаження викладачів">
        <button className="mb-3 rounded-lg bg-pine px-4 py-2 font-semibold text-white" onClick={load}>
          Оновити
        </button>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-600">
                <th className="px-2 py-2">Номер за порядком</th>
                <th className="px-2 py-2">Прізвище, ім'я та по батькові викладача</th>
                <th className="px-2 py-2">Загальна кількість годин</th>
                <th className="px-2 py-2">Річне педнавантаження</th>
                <th className="px-2 py-2">Залишок годин</th>
                {canEditAnnualLoad && <th className="px-2 py-2">Дія</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.teacher_id} className="border-b border-slate-100">
                  <td className="px-2 py-2">{row.row_number}</td>
                  <td className="px-2 py-2">{row.teacher_name}</td>
                  <td className="px-2 py-2">{row.total_hours}</td>
                  <td className="px-2 py-2">
                    {canEditAnnualLoad ? (
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="w-28 rounded border border-slate-300 px-2 py-1"
                        value={annualLoadDrafts[row.teacher_id] ?? String(row.annual_load_hours ?? 0)}
                        onChange={(event) =>
                          setAnnualLoadDrafts((prev) => ({ ...prev, [row.teacher_id]: event.target.value }))
                        }
                      />
                    ) : (
                      row.annual_load_hours
                    )}
                  </td>
                  <td className="px-2 py-2">{row.remaining_hours}</td>
                  {canEditAnnualLoad && (
                    <td className="px-2 py-2">
                      <button
                        className="rounded bg-amber px-2 py-1 text-xs font-semibold text-ink"
                        onClick={() => saveAnnualLoad(row.teacher_id)}
                      >
                        Зберегти
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
