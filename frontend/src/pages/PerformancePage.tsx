import { FormEvent, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { FormField, FormSubmitButton, formControlClass } from "../components/FormField";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { usePageRefresh } from "../hooks/usePageRefresh";
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

function getPercentBadgeClass(value: number, warningThreshold: number, criticalThreshold: number): string {
  if (value < criticalThreshold) return "bg-rose-100 text-rose-700";
  if (value < warningThreshold) return "bg-amber-100 text-amber-800";
  return "bg-emerald-100 text-emerald-700";
}

function getPerformanceRowClassName(item: Performance): string | undefined {
  if (item.progress_pct < 60 || item.attendance_pct < 70) return "bg-rose-50";
  if (item.progress_pct < 75 || item.attendance_pct < 85) return "bg-amber-50";
  return undefined;
}

export function PerformancePage() {
  const { request, user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [rows, setRows] = useState<Performance[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [form, setForm] = useState<PerformancePayload>(DEFAULT_FORM);
  const [fieldErrors, setFieldErrors] = useState<{
    groupId?: string;
    traineeId?: string;
    progress?: string;
    attendance?: string;
  }>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [performanceToDelete, setPerformanceToDelete] = useState<Performance | null>(null);

  const canDelete = useMemo(
    () => user?.roles.some((role) => role.name === "admin" || role.name === "methodist") ?? false,
    [user]
  );

  const groupLookup = useMemo(
    () => Object.fromEntries(groups.map((group) => [group.id, `${group.code} - ${group.name}`])),
    [groups]
  );
  const traineeLookup = useMemo(
    () => Object.fromEntries(trainees.map((trainee) => [trainee.id, `${trainee.last_name} ${trainee.first_name}`])),
    [trainees]
  );

  const load = async () => {
    setIsLoading(true);
    try {
      const [performanceRows, groupRows, traineeRows] = await Promise.all([
        request<Performance[]>("/performance"),
        request<Group[]>("/groups"),
        request<Trainee[]>("/trainees")
      ]);
      setRows(performanceRows);
      setGroups(groupRows);
      setTrainees(traineeRows);
      setLoadError(null);
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

  usePageRefresh(load, {
    enabled: !editingId && !isSubmitting && !isDeleting
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      ...form,
      trainee_id: Number(form.trainee_id),
      group_id: Number(form.group_id),
      progress_pct: Number(form.progress_pct),
      attendance_pct: Number(form.attendance_pct)
    };
    const nextErrors: {
      groupId?: string;
      traineeId?: string;
      progress?: string;
      attendance?: string;
    } = {};
    if (!payload.group_id) nextErrors.groupId = "Оберіть групу";
    if (!payload.trainee_id) nextErrors.traineeId = "Оберіть слухача";
    if (!Number.isFinite(payload.progress_pct) || payload.progress_pct < 0 || payload.progress_pct > 100) {
      nextErrors.progress = "Прогрес має бути від 0 до 100";
    }
    if (!Number.isFinite(payload.attendance_pct) || payload.attendance_pct < 0 || payload.attendance_pct > 100) {
      nextErrors.attendance = "Відвідуваність має бути від 0 до 100";
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      showError(Object.values(nextErrors)[0]);
      return;
    }
    setFieldErrors({});
    setIsSubmitting(true);
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
      setFieldErrors({});
      setEditingId(null);
      await load();
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsSubmitting(false);
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
    setFieldErrors({});
  };

  const remove = async (item: Performance) => {
    setPerformanceToDelete(item);
  };

  const confirmDelete = async () => {
    if (!performanceToDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      await request<void>(`/performance/${performanceToDelete.id}`, { method: "DELETE" });
      showSuccess("Запис видалено");
      if (editingId === performanceToDelete.id) {
        setEditingId(null);
        setForm(DEFAULT_FORM);
      }
      setPerformanceToDelete(null);
      await load();
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsDeleting(false);
    }
  };

  const columns = useMemo<DataTableColumn<Performance>[]>(() => {
    const baseColumns: DataTableColumn<Performance>[] = [
      {
        key: "id",
        header: "ID",
        render: (item) => item.id,
        sortAccessor: (item) => item.id
      },
      {
        key: "group",
        header: "Група",
        render: (item) => groupLookup[item.group_id] || item.group_id,
        sortAccessor: (item) => groupLookup[item.group_id] || String(item.group_id)
      },
      {
        key: "trainee",
        header: "Слухач",
        render: (item) => traineeLookup[item.trainee_id] || item.trainee_id,
        sortAccessor: (item) => traineeLookup[item.trainee_id] || String(item.trainee_id)
      },
      {
        key: "progress",
        header: "Прогрес",
        render: (item) => (
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getPercentBadgeClass(item.progress_pct, 75, 60)}`}>
            {item.progress_pct}%
          </span>
        ),
        sortAccessor: (item) => item.progress_pct
      },
      {
        key: "attendance",
        header: "Відвідування",
        render: (item) => (
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getPercentBadgeClass(item.attendance_pct, 85, 70)}`}>
            {item.attendance_pct}%
          </span>
        ),
        sortAccessor: (item) => item.attendance_pct
      },
      {
        key: "employment",
        header: "Працевлаштування",
        render: (item) => (item.employment_flag ? "Так" : "Ні"),
        sortAccessor: (item) => (item.employment_flag ? 1 : 0)
      }
    ];

    return [
      ...baseColumns,
      {
        key: "actions",
        header: "Дії",
        render: (item) => (
          <div className="flex gap-2">
            <button className="rounded bg-amber px-2 py-1 text-xs font-semibold text-ink" onClick={() => startEdit(item)}>
              Редагувати
            </button>
            {canDelete && (
              <button
                className="rounded bg-red-100 px-2 py-1 text-xs font-semibold text-red-700"
                onClick={() => remove(item)}
              >
                Видалити
              </button>
            )}
          </div>
        )
      }
    ];
  }, [canDelete, groupLookup, traineeLookup, remove, startEdit]);

  return (
    <div className="space-y-5">
      <Panel title={editingId ? "Редагування успішності" : "Нова оцінка успішності"}>
        <form className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" onSubmit={submit}>
          <FormField label="Група" required errorText={fieldErrors.groupId}>
            <select
              className={formControlClass}
              value={form.group_id || ""}
              onChange={(event) => {
                setForm((prev) => ({ ...prev, group_id: Number(event.target.value) }));
                setFieldErrors((prev) => ({ ...prev, groupId: undefined }));
              }}
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
          </FormField>
          <FormField label="Слухач" required errorText={fieldErrors.traineeId}>
            <select
              className={formControlClass}
              value={form.trainee_id || ""}
              onChange={(event) => {
                setForm((prev) => ({ ...prev, trainee_id: Number(event.target.value) }));
                setFieldErrors((prev) => ({ ...prev, traineeId: undefined }));
              }}
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
          </FormField>
          <FormField
            label="Прогрес, %"
            required
            helperText="Значення від 0 до 100"
            errorText={fieldErrors.progress}
          >
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              className={formControlClass}
              value={form.progress_pct}
              onChange={(event) => {
                setForm((prev) => ({ ...prev, progress_pct: Number(event.target.value) }));
                setFieldErrors((prev) => ({ ...prev, progress: undefined }));
              }}
              required
            />
          </FormField>
          <FormField
            label="Відвідуваність, %"
            required
            helperText="Значення від 0 до 100"
            errorText={fieldErrors.attendance}
          >
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              className={formControlClass}
              value={form.attendance_pct}
              onChange={(event) => {
                setForm((prev) => ({ ...prev, attendance_pct: Number(event.target.value) }));
                setFieldErrors((prev) => ({ ...prev, attendance: undefined }));
              }}
              required
            />
          </FormField>
          <FormField label="Статус працевлаштування">
            <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={form.employment_flag}
                onChange={(event) => setForm((prev) => ({ ...prev, employment_flag: event.target.checked }))}
              />
              Працевлаштований
            </label>
          </FormField>
          <div className="flex flex-wrap items-center gap-2">
            <FormSubmitButton
              isLoading={isSubmitting}
              idleLabel={editingId ? "Оновити" : "Створити"}
              loadingLabel={editingId ? "Оновлюємо..." : "Створюємо..."}
              className="rounded-lg bg-pine px-4 py-2 font-semibold text-white"
            />
            {editingId && (
              <button
                type="button"
                className="rounded-lg bg-slate-200 px-4 py-2 font-semibold text-slate-800"
                onClick={() => {
                  setEditingId(null);
                  setForm(DEFAULT_FORM);
                  setFieldErrors({});
                }}
              >
                Скасувати
              </button>
            )}
          </div>
        </form>
      </Panel>

      <Panel title="Моніторинг успішності">
        <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
            onClick={load}
            disabled={isLoading}
          >
            {isLoading ? "Оновлюємо..." : "Оновити"}
          </button>
        </div>
        <DataTable
          data={rows}
          columns={columns}
          rowKey={(item) => item.id}
          isLoading={isLoading}
          errorText={loadError}
          onRetry={load}
          rowClassName={getPerformanceRowClassName}
          emptyText="Записи успішності відсутні"
          emptyActionLabel="Оновити записи"
          onEmptyAction={load}
          emptyActionDisabled={isLoading}
          search={{
            placeholder: "Пошук за групою, слухачем або ID",
            getSearchText: (item) =>
              `${item.id} ${groupLookup[item.group_id] || item.group_id} ${traineeLookup[item.trainee_id] || item.trainee_id}`,
            emptyResultText: "Нічого не знайдено за запитом"
          }}
        />
      </Panel>
      <ConfirmDialog
        open={Boolean(performanceToDelete)}
        title="Підтвердження видалення"
        description={
          performanceToDelete
            ? `Видалити запис успішності для "${traineeLookup[performanceToDelete.trainee_id] || performanceToDelete.trainee_id}"?`
            : ""
        }
        confirmLabel={isDeleting ? "Видаляємо..." : "Видалити"}
        confirmDisabled={isDeleting}
        onCancel={() => {
          if (isDeleting) return;
          setPerformanceToDelete(null);
        }}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
