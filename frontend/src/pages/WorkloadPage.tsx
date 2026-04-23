import { useEffect, useState } from "react";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import type { Workload } from "../types/api";

export function WorkloadPage() {
  const { request } = useAuth();
  const [rows, setRows] = useState<Workload[]>([]);
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    try {
      const data = await request<Workload[]>("/teacher-workload");
      setRows(data);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-5">
      {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <Panel title="Навантаження викладачів">
        <button className="mb-3 rounded-lg bg-pine px-4 py-2 font-semibold text-white" onClick={load}>
          Оновити
        </button>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-600">
                <th className="px-2 py-2">Викладач</th>
                <th className="px-2 py-2">Години</th>
                <th className="px-2 py-2">Сума, грн</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.teacher_id} className="border-b border-slate-100">
                  <td className="px-2 py-2">{row.teacher_name}</td>
                  <td className="px-2 py-2">{row.total_hours}</td>
                  <td className="px-2 py-2">{row.amount_uah}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

