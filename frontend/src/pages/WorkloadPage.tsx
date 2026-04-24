import { useEffect, useState } from "react";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import type { Workload } from "../types/api";

export function WorkloadPage() {
  const { request, user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [rows, setRows] = useState<Workload[]>([]);
  const [annualLoadDrafts, setAnnualLoadDrafts] = useState<Record<number, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const canEditAnnualLoad =
    user?.roles.some((role) => role.name === "admin" || role.name === "methodist") ?? false;

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await request<Workload[]>("/teacher-workload");
      setRows(data);
      setLoadError(null);
      setAnnualLoadDrafts(
        Object.fromEntries(data.map((row) => [row.teacher_id, String(row.annual_load_hours ?? 0)]))
      );
    } catch (error) {
      const message = (error as Error).message;
      setLoadError(message);
      showError(message);
    } finally {
      setIsLoading(false);
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

  const columns: DataTableColumn<Workload>[] = [
    {
      key: "row_number",
      header: "Номер за порядком",
      render: (row) => row.row_number,
      sortAccessor: (row) => row.row_number
    },
    {
      key: "teacher_name",
      header: "Прізвище, ім'я та по батькові викладача",
      render: (row) => row.teacher_name,
      sortAccessor: (row) => row.teacher_name
    },
    {
      key: "total_hours",
      header: "Загальна кількість годин",
      render: (row) => row.total_hours,
      sortAccessor: (row) => row.total_hours
    },
    {
      key: "annual_load_hours",
      header: "Річне педнавантаження",
      render: (row) =>
        canEditAnnualLoad ? (
          <input
            type="number"
            min={0}
            step={1}
            className="w-28 rounded border border-slate-300 px-2 py-1"
            value={annualLoadDrafts[row.teacher_id] ?? String(row.annual_load_hours ?? 0)}
            onChange={(event) => setAnnualLoadDrafts((prev) => ({ ...prev, [row.teacher_id]: event.target.value }))}
          />
        ) : (
          row.annual_load_hours
        ),
      sortAccessor: (row) => row.annual_load_hours
    },
    {
      key: "remaining_hours",
      header: "Залишок годин",
      render: (row) => row.remaining_hours,
      sortAccessor: (row) => row.remaining_hours
    },
    ...(canEditAnnualLoad
      ? [
          {
            key: "actions",
            header: "Дія",
            render: (row: Workload) => (
              <button
                className="rounded bg-amber px-2 py-1 text-xs font-semibold text-ink"
                onClick={() => saveAnnualLoad(row.teacher_id)}
              >
                Зберегти
              </button>
            )
          }
        ]
      : [])
  ];

  return (
    <div className="space-y-5">
      <Panel title="Навантаження викладачів">
        <button className="mb-3 rounded-lg bg-pine px-4 py-2 font-semibold text-white" onClick={load}>
          Оновити
        </button>
        <DataTable
          data={rows}
          columns={columns}
          rowKey={(row) => row.teacher_id}
          isLoading={isLoading}
          errorText={loadError}
          onRetry={load}
          emptyText="Дані педнавантаження відсутні"
          search={{
            placeholder: "Пошук викладача",
            getSearchText: (row) => row.teacher_name
          }}
        />
      </Panel>
    </div>
  );
}
