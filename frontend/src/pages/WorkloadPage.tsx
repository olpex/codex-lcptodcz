import { useEffect, useMemo, useState } from "react";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { Panel } from "../components/Panel";
import { TrendStatCard } from "../components/TrendStatCard";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { API_URL } from "../api/client";
import type { Workload, Job, TeacherMergeResult } from "../types/api";
import { usePageRefresh } from "../hooks/usePageRefresh";

const STATS_HISTORY_LIMIT = 12;

type WorkloadSnapshot = {
  teachers: number;
  totalHours: number;
  annualLoadHours: number;
  remainingHours: number;
};

function getWorkloadRowClassName(row: Workload): string | undefined {
  if (row.remaining_hours < 0) return "bg-rose-50";
  if (row.annual_load_hours <= 0 || row.remaining_hours === 0) return "bg-amber-50";
  return undefined;
}

function getRemainingHoursClass(row: Workload): string {
  if (row.remaining_hours < 0) return "bg-rose-100 text-rose-700";
  if (row.remaining_hours === 0) return "bg-amber-100 text-amber-800";
  return "bg-emerald-100 text-emerald-700";
}

export function WorkloadPage() {
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<number[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const { request, user, accessToken } = useAuth();
  const { showError, showSuccess } = useToast();
  const [rows, setRows] = useState<Workload[]>([]);
  const [annualLoadDrafts, setAnnualLoadDrafts] = useState<Record<number, string>>({});
  const [annualLoadErrors, setAnnualLoadErrors] = useState<Record<number, string>>({});
  const [savingTeacherId, setSavingTeacherId] = useState<number | null>(null);
  const [deletingTeacher, setDeletingTeacher] = useState<Workload | null>(null);
  const [isMergeDialogOpen, setIsMergeDialogOpen] = useState(false);
  const [mergeTargetTeacherId, setMergeTargetTeacherId] = useState<number | null>(null);
  const [isMergingTeachers, setIsMergingTeachers] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statsHistory, setStatsHistory] = useState<WorkloadSnapshot[]>([]);
  const canEditAnnualLoad =
    user?.roles.some((role) => role.name === "admin" || role.name === "methodist") ?? false;

  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const buildSnapshot = (data: Workload[]): WorkloadSnapshot => {
    const totals = data.reduce(
      (acc, row) => {
        acc.totalHours += row.total_hours || 0;
        acc.annualLoadHours += row.annual_load_hours || 0;
        acc.remainingHours += row.remaining_hours || 0;
        return acc;
      },
      { totalHours: 0, annualLoadHours: 0, remainingHours: 0 }
    );
    return {
      teachers: data.length,
      totalHours: Number(totals.totalHours.toFixed(1)),
      annualLoadHours: Number(totals.annualLoadHours.toFixed(1)),
      remainingHours: Number(totals.remainingHours.toFixed(1))
    };
  };

  const appendSnapshot = (data: Workload[]) => {
    const snapshot = buildSnapshot(data);
    setStatsHistory((prev) => {
      const next = [...prev, snapshot];
      if (next.length <= STATS_HISTORY_LIMIT) return next;
      return next.slice(next.length - STATS_HISTORY_LIMIT);
    });
  };

  const load = async (overrideDateFrom?: string, overrideDateTo?: string) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      const dFrom = overrideDateFrom !== undefined ? overrideDateFrom : dateFrom;
      const dTo = overrideDateTo !== undefined ? overrideDateTo : dateTo;
      if (dFrom) params.append("date_from", dFrom);
      if (dTo) params.append("date_to", dTo);
      const query = params.toString() ? `?${params.toString()}` : "";

      const data = await request<Workload[]>(`/teacher-workload${query}`);
      setRows(data);
      appendSnapshot(data);
      setLoadError(null);
      setAnnualLoadDrafts(
        Object.fromEntries(data.map((row) => [row.teacher_id, String(row.annual_load_hours ?? 0)]))
      );
      setAnnualLoadErrors({});
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

  usePageRefresh(() => load(), {
    enabled: savingTeacherId === null && !isDeleting && !isExporting
  });

  const seriesByKey = useMemo(
    () => ({
      teachers: statsHistory.map((item) => item.teachers),
      totalHours: statsHistory.map((item) => item.totalHours),
      annualLoadHours: statsHistory.map((item) => item.annualLoadHours),
      remainingHours: statsHistory.map((item) => item.remainingHours)
    }),
    [statsHistory]
  );

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedTeacherIds.includes(row.teacher_id)),
    [rows, selectedTeacherIds]
  );

  const mergeTarget = useMemo(
    () => selectedRows.find((row) => row.teacher_id === mergeTargetTeacherId) || selectedRows[0] || null,
    [mergeTargetTeacherId, selectedRows]
  );

  const mergeSources = useMemo(
    () => selectedRows.filter((row) => row.teacher_id !== mergeTarget?.teacher_id),
    [mergeTarget?.teacher_id, selectedRows]
  );

  const openMergeDialog = () => {
    if (selectedRows.length < 2) {
      showError("Оберіть щонайменше двох викладачів для об'єднання");
      return;
    }
    setMergeTargetTeacherId(selectedRows[0].teacher_id);
    setIsMergeDialogOpen(true);
  };

  const saveAnnualLoad = async (teacherId: number) => {
    if (savingTeacherId !== null) return;
    const draftValue = annualLoadDrafts[teacherId];
    const value = Number(draftValue);
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
      const message = "Річне педнавантаження має бути невід'ємним цілим числом";
      setAnnualLoadErrors((prev) => ({ ...prev, [teacherId]: message }));
      showError(message);
      return;
    }
    setAnnualLoadErrors((prev) => ({ ...prev, [teacherId]: "" }));
    setSavingTeacherId(teacherId);
    try {
      await request(`/teachers/${teacherId}`, {
        method: "PUT",
        body: JSON.stringify({ annual_load_hours: value })
      });
      showSuccess("Річне педнавантаження оновлено");
      await load();
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setSavingTeacherId(null);
    }
  };

  const handleDeleteTeacher = async () => {
    if (!deletingTeacher) return;
    setIsDeleting(true);
    try {
      await request(`/teachers/${deletingTeacher.teacher_id}`, { method: "DELETE" });
      showSuccess(`Викладача ${deletingTeacher.teacher_name} успішно видалено`);
      setDeletingTeacher(null);
      await load();
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleMergeTeachers = async () => {
    if (!mergeTarget || mergeSources.length === 0) return;
    setIsMergingTeachers(true);
    try {
      const result = await request<TeacherMergeResult>("/teacher-workload/merge-teachers", {
        method: "POST",
        body: JSON.stringify({
          target_teacher_id: mergeTarget.teacher_id,
          source_teacher_ids: mergeSources.map((row) => row.teacher_id)
        })
      });
      showSuccess(
        `Викладачів об'єднано: перенесено занять ${result.reassigned_slots}, річне навантаження ${result.annual_load_hours}`
      );
      setIsMergeDialogOpen(false);
      setSelectedTeacherIds([]);
      setMergeTargetTeacherId(null);
      await load();
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsMergingTeachers(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const payload = {
        report_type: "teacher_workload",
        export_format: "xlsx",
        teacher_ids: selectedTeacherIds.length > 0 ? selectedTeacherIds : rows.map(r => r.teacher_id),
        start_date: dateFrom || null,
        end_date: dateTo || null
      };

      const job = await request<Job>("/documents/export", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      showSuccess("Експорт запущено, зачекайте...");

      // Poll for completion
      let currentJob = job;
      while (currentJob.status !== "succeeded" && currentJob.status !== "failed") {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const res = await request<{ job: Job }>(`/jobs/${job.id}`);
        currentJob = res.job;
      }

      if (currentJob.status === "failed") {
        throw new Error(currentJob.message || "Помилка при генерації звіту");
      }

      const payloadResult = currentJob.result_payload as Record<string, unknown> | null;
      const outputDocumentId = payloadResult?.output_document_id as number | undefined;

      if (!outputDocumentId) {
        throw new Error("Не знайдено ID згенерованого документа");
      }

      const downloadRes = await fetch(`${API_URL}/documents/${outputDocumentId}/download`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!downloadRes.ok) {
        throw new Error(`Не вдалося завантажити файл (${downloadRes.status})`);
      }

      const blob = await downloadRes.blob();
      const disposition = downloadRes.headers.get("content-disposition") || "";
      const fileNameMatch = disposition.match(/filename="?([^"]+)"?/i);
      const fileName = fileNameMatch?.[1] || `workload_${outputDocumentId}.xlsx`;

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      
      showSuccess("Звіт успішно завантажено");
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsExporting(false);
    }
  };

  const columns: DataTableColumn<Workload>[] = [
    {
      key: "select",
      header: "Вибір",
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedTeacherIds.includes(row.teacher_id)}
          onChange={(e) => {
            if (e.target.checked) {
              setSelectedTeacherIds((prev) => [...prev, row.teacher_id]);
            } else {
              setSelectedTeacherIds((prev) => prev.filter((id) => id !== row.teacher_id));
            }
          }}
          className="rounded border-slate-300 text-pine focus:ring-pine"
        />
      )
    },
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
          <div className="min-w-[210px]">
            <input
              type="number"
              min={0}
              step={1}
              className={`w-28 rounded border px-2 py-1 ${
                annualLoadErrors[row.teacher_id] ? "border-red-400" : "border-slate-300"
              }`}
              value={annualLoadDrafts[row.teacher_id] ?? String(row.annual_load_hours ?? 0)}
              onChange={(event) => {
                const value = event.target.value;
                setAnnualLoadDrafts((prev) => ({ ...prev, [row.teacher_id]: value }));
                setAnnualLoadErrors((prev) => ({ ...prev, [row.teacher_id]: "" }));
              }}
              disabled={savingTeacherId === row.teacher_id}
            />
            {annualLoadErrors[row.teacher_id] && (
              <p className="mt-1 max-w-[200px] text-xs font-semibold text-red-700">{annualLoadErrors[row.teacher_id]}</p>
            )}
          </div>
        ) : (
          row.annual_load_hours
        ),
      sortAccessor: (row) => row.annual_load_hours
    },
    {
      key: "remaining_hours",
      header: "Залишок годин",
      render: (row) => (
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getRemainingHoursClass(row)}`}>
          {row.remaining_hours}
        </span>
      ),
      sortAccessor: (row) => row.remaining_hours
    },
    ...(canEditAnnualLoad
      ? [
          {
            key: "actions",
            header: "Дія",
            render: (row: Workload) => (
              <div className="flex items-center gap-2">
                <button
                  className="rounded bg-amber px-2 py-1 text-xs font-semibold text-ink disabled:opacity-50"
                  onClick={() => saveAnnualLoad(row.teacher_id)}
                  disabled={savingTeacherId !== null}
                >
                  {savingTeacherId === row.teacher_id ? "Збереження..." : "Зберегти"}
                </button>
                <button
                  className="rounded bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50"
                  onClick={() => setDeletingTeacher(row)}
                  disabled={savingTeacherId !== null || isDeleting}
                >
                  Видалити
                </button>
              </div>
            )
          }
        ]
      : [])
  ];

  return (
    <div className="space-y-5">
      <Panel title="Навантаження викладачів">
        <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              key: "teachers",
              title: "Викладачів у звіті",
              series: seriesByKey.teachers,
              suffix: ""
            },
            {
              key: "totalHours",
              title: "Загалом відпрацьовано годин",
              series: seriesByKey.totalHours,
              suffix: " год"
            },
            {
              key: "annualLoadHours",
              title: "Річне педнавантаження (сумарно)",
              series: seriesByKey.annualLoadHours,
              suffix: " год"
            },
            {
              key: "remainingHours",
              title: "Залишок годин (сумарно)",
              series: seriesByKey.remainingHours,
              suffix: " год"
            }
          ].map((item) => {
            const current = item.series.length ? item.series[item.series.length - 1] : 0;
            const previous = item.series.length > 1 ? item.series[item.series.length - 2] : null;
            const delta = previous == null ? null : Number((current - previous).toFixed(1));
            const valueLabel =
              isLoading && item.series.length === 0 ? "…" : `${current.toLocaleString("uk-UA")}${item.suffix}`;
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
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">Період з</label>
            <input 
              type="date" 
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-pine focus:outline-none focus:ring-1 focus:ring-pine" 
              value={dateFrom} 
              onChange={e => setDateFrom(e.target.value)} 
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-700">Період до</label>
            <input 
              type="date" 
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-pine focus:outline-none focus:ring-1 focus:ring-pine" 
              value={dateTo} 
              onChange={e => setDateTo(e.target.value)} 
            />
          </div>
          <button className="rounded-lg bg-pine px-4 py-2 font-semibold text-white" onClick={() => load()}>
            Застосувати
          </button>
          <button
            type="button"
            className="rounded-lg bg-amber px-4 py-2 font-semibold text-ink disabled:opacity-50"
            onClick={() => load()}
            disabled={isLoading}
          >
            {isLoading ? "Оновлюємо..." : "Оновити"}
          </button>
          {(dateFrom || dateTo) && (
            <button 
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50" 
              onClick={() => { 
                setDateFrom(""); 
                setDateTo(""); 
                load("", "");
              }}
            >
              Скинути дати
            </button>
          )}
          
          <div className="flex-1"></div>

          {canEditAnnualLoad && (
            <button
              className="rounded-lg bg-slate-800 px-4 py-2 font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
              onClick={openMergeDialog}
              disabled={selectedTeacherIds.length < 2 || isMergingTeachers}
            >
              Об'єднати обраних ({selectedTeacherIds.length})
            </button>
          )}

          {canEditAnnualLoad && (
            <button
              className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white disabled:opacity-50 hover:bg-indigo-700"
              onClick={handleExport}
              disabled={isExporting || rows.length === 0}
            >
              {isExporting ? "Формування..." : selectedTeacherIds.length > 0 ? `Експорт обраних (${selectedTeacherIds.length})` : "Експорт всіх"}
            </button>
          )}
        </div>
        <DataTable
          data={rows}
          columns={columns}
          rowKey={(row) => row.teacher_id}
          isLoading={isLoading}
          errorText={loadError}
          onRetry={() => load()}
          rowClassName={getWorkloadRowClassName}
          emptyText="Дані педнавантаження відсутні"
          emptyActionLabel="Оновити навантаження"
          onEmptyAction={() => load()}
          emptyActionDisabled={isLoading}
          search={{
            placeholder: "Пошук викладача",
            getSearchText: (row) => row.teacher_name
          }}
        />
      </Panel>

      <ConfirmDialog
        open={isMergeDialogOpen}
        title="Об'єднання викладачів"
        description={
          mergeTarget
            ? `Основним залишиться "${mergeTarget.teacher_name}". Усі заняття й річне навантаження обраних дублікатів буде перенесено на нього.`
            : "Оберіть основного викладача для об'єднання."
        }
        confirmLabel="Об'єднати"
        cancelLabel="Скасувати"
        confirmVariant="primary"
        confirmDisabled={!mergeTarget || mergeSources.length === 0 || isMergingTeachers}
        onConfirm={handleMergeTeachers}
        onCancel={() => {
          setIsMergeDialogOpen(false);
          setMergeTargetTeacherId(null);
        }}
      >
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Основний викладач
            </span>
            <select
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              value={mergeTarget?.teacher_id || ""}
              onChange={(event) => setMergeTargetTeacherId(Number(event.target.value))}
            >
              {selectedRows.map((row) => (
                <option key={row.teacher_id} value={row.teacher_id}>
                  {row.teacher_name} · {row.total_hours} год · річне {row.annual_load_hours}
                </option>
              ))}
            </select>
          </label>
          <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            <p className="font-semibold text-ink">Будуть приєднані:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {mergeSources.map((row) => (
                <li key={row.teacher_id}>
                  {row.teacher_name}: {row.total_hours} год, річне {row.annual_load_hours}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!deletingTeacher}
        title="Видалення викладача"
        description={deletingTeacher ? `Ви впевнені, що хочете видалити викладача "${deletingTeacher.teacher_name}"? Ця дія призведе до видалення всіх пов'язаних записів у розкладі та навантаженні.` : ""}
        confirmLabel="Видалити"
        cancelLabel="Скасувати"
        confirmVariant="danger"
        confirmDisabled={isDeleting}
        onConfirm={handleDeleteTeacher}
        onCancel={() => setDeletingTeacher(null)}
      />
    </div>
  );
}
