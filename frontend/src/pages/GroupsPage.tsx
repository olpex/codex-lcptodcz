import { FormEvent, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { FormField, FormSubmitButton, formControlClass } from "../components/FormField";
import { Panel } from "../components/Panel";
import { API_URL } from "../api/client";
import { formatGroupStatus } from "../i18n/statuses";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { usePageRefresh } from "../hooks/usePageRefresh";
import type { ActiveGroupBetweenDates, Group } from "../types/api";

export function GroupsPage() {
  const { request, user, accessToken } = useAuth();
  const { showError, showSuccess } = useToast();
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroups, setActiveGroups] = useState<ActiveGroupBetweenDates[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [capacity, setCapacity] = useState(25);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; code?: string; capacity?: string }>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isFiltering, setIsFiltering] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // --- Стан видалення групи ---
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<Group | null>(null);
  const [deleteTrainees, setDeleteTrainees] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const canEdit = useMemo(
    () => user?.roles.some((role) => role.name === "admin" || role.name === "methodist") ?? false,
    [user]
  );

  const columns = useMemo<DataTableColumn<Group>[]>(
    () => [
      {
        key: "code",
        header: "Код",
        render: (group) => <span className="font-semibold">{group.code}</span>,
        sortAccessor: (group) => group.code
      },
      {
        key: "name",
        header: "Назва",
        render: (group) => group.name,
        sortAccessor: (group) => group.name
      },
      {
        key: "status",
        header: "Статус",
        render: (group) => formatGroupStatus(group.status),
        sortAccessor: (group) => formatGroupStatus(group.status)
      },
      {
        key: "capacity",
        header: "Місткість",
        render: (group) => group.capacity,
        sortAccessor: (group) => group.capacity
      },
      ...(canEdit
        ? [
            {
              key: "actions" as const,
              header: "",
              render: (group: Group) => (
                <button
                  type="button"
                  id={`delete-group-${group.id}`}
                  className="rounded-lg border border-rose-300 px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    openDeleteDialog(group);
                  }}
                >
                  Видалити
                </button>
              )
            }
          ]
        : [])
    ],
    [canEdit]
  );

  const activeGroupColumns = useMemo<DataTableColumn<ActiveGroupBetweenDates>[]>(
    () => [
      {
        key: "code",
        header: "Код",
        render: (group) => <span className="font-semibold">{group.code}</span>,
        sortAccessor: (group) => group.code
      },
      {
        key: "name",
        header: "Назва",
        render: (group) => group.name,
        sortAccessor: (group) => group.name
      },
      {
        key: "period",
        header: "Дати навчання",
        render: (group) =>
          `${group.training_start_date || group.period_start_date} — ${group.training_end_date || group.period_end_date}`,
        sortAccessor: (group) => group.training_start_date || group.period_start_date
      },
      {
        key: "teachers",
        header: "Викладачі та години",
        render: (group) => (
          <div className="space-y-1">
            {group.teachers.map((teacher) => (
              <div key={teacher.teacher_id}>
                {teacher.teacher_name}: <span className="font-semibold">{teacher.hours}</span>
              </div>
            ))}
          </div>
        ),
        sortAccessor: (group) => group.teachers.map((teacher) => teacher.teacher_name).join(" ")
      },
      {
        key: "total_hours",
        header: "Усього год.",
        render: (group) => group.total_hours,
        sortAccessor: (group) => group.total_hours
      }
    ],
    []
  );

  const loadGroups = async () => {
    setIsLoading(true);
    try {
      const data = await request<Group[]>("/groups");
      setGroups(data);
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
    loadGroups();
  }, []);

  usePageRefresh(loadGroups);

  const validatePeriod = () => {
    if (!dateFrom || !dateTo) {
      return "Вкажіть дату початку і дату завершення";
    }
    if (dateTo < dateFrom) {
      return "Дата завершення має бути не раніше дати початку";
    }
    return null;
  };

  const loadActiveGroups = async () => {
    const validationMessage = validatePeriod();
    if (validationMessage) {
      setFilterError(validationMessage);
      showError(validationMessage);
      return;
    }
    setIsFiltering(true);
    try {
      const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      const data = await request<ActiveGroupBetweenDates[]>(`/groups/active-between?${params.toString()}`);
      setActiveGroups(data);
      setFilterError(null);
      showSuccess(data.length ? `Знайдено груп: ${data.length}` : "За цей період груп не знайдено");
    } catch (error) {
      const message = (error as Error).message;
      setFilterError(message);
      showError(message);
    } finally {
      setIsFiltering(false);
    }
  };

  const exportActiveGroups = async () => {
    const validationMessage = validatePeriod();
    if (validationMessage) {
      setFilterError(validationMessage);
      showError(validationMessage);
      return;
    }
    if (!accessToken) {
      showError("Потрібна авторизація");
      return;
    }
    setIsExporting(true);
    try {
      const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
      const response = await fetch(`${API_URL}/groups/active-between/export?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!response.ok) {
        throw new Error(`Не вдалося сформувати Excel (${response.status})`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const fileNameMatch = disposition.match(/filename="?([^"]+)"?/i);
      const fileName = fileNameMatch?.[1] || `groups_${dateFrom}_${dateTo}.xlsx`;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      showSuccess("Excel-файл завантажено");
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsExporting(false);
    }
  };

  const createGroup = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit) return;
    const nextErrors: { name?: string; code?: string; capacity?: string } = {};
    if (!code.trim()) nextErrors.code = "Вкажіть код групи";
    if (!name.trim()) nextErrors.name = "Вкажіть назву групи";
    if (!Number.isFinite(capacity) || capacity < 1 || capacity > 200) {
      nextErrors.capacity = "Місткість має бути від 1 до 200";
    }
    if (Object.keys(nextErrors).length) {
      setFieldErrors(nextErrors);
      showError(Object.values(nextErrors)[0]);
      return;
    }
    setFieldErrors({});
    setIsSubmitting(true);
    try {
      await request<Group>("/groups", {
        method: "POST",
        body: JSON.stringify({
          name,
          code,
          capacity,
          status: "planned"
        })
      });
      setName("");
      setCode("");
      setCapacity(25);
      await loadGroups();
      showSuccess("Групу створено");
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openDeleteDialog = (group: Group) => {
    setGroupToDelete(group);
    setDeleteTrainees(false);
    setDeleteDialogOpen(true);
  };

  const closeDeleteDialog = () => {
    if (isDeleting) return;
    setDeleteDialogOpen(false);
    setGroupToDelete(null);
    setDeleteTrainees(false);
  };

  const confirmDeleteGroup = async () => {
    if (!groupToDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      const params = deleteTrainees ? "?delete_trainees=true" : "";
      await request(`/groups/${groupToDelete.id}${params}`, { method: "DELETE" });
      await loadGroups();
      const suffix = deleteTrainees ? " разом зі слухачами" : "";
      showSuccess(`Групу «${groupToDelete.code}» видалено${suffix}`);
      closeDeleteDialog();
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsDeleting(false);
    }
  };

  const deleteDialogDescription = groupToDelete
    ? `Видалити групу «${groupToDelete.code} — ${groupToDelete.name}»? Цю дію не можна скасувати.`
    : "";

  return (
    <div className="space-y-5">
      {canEdit && (
        <Panel title="Створити групу">
          <form className="grid gap-3 md:grid-cols-4" onSubmit={createGroup}>
            <FormField
              label="Код групи"
              required
              helperText="Наприклад: М-2026-01"
              errorText={fieldErrors.code}
            >
              <input
                className={formControlClass}
                placeholder="Код групи"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  setFieldErrors((prev) => ({ ...prev, code: undefined }));
                }}
                required
              />
            </FormField>
            <FormField
              label="Назва групи"
              required
              helperText="Повна назва навчальної групи"
              errorText={fieldErrors.name}
            >
              <input
                className={formControlClass}
                placeholder="Назва групи"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setFieldErrors((prev) => ({ ...prev, name: undefined }));
                }}
                required
              />
            </FormField>
            <FormField label="Місткість" helperText="Від 1 до 200 слухачів" errorText={fieldErrors.capacity}>
              <input
                type="number"
                className={formControlClass}
                value={capacity}
                min={1}
                max={200}
                onChange={(event) => {
                  setCapacity(Number(event.target.value));
                  setFieldErrors((prev) => ({ ...prev, capacity: undefined }));
                }}
              />
            </FormField>
            <div className="flex items-end">
              <FormSubmitButton
                isLoading={isSubmitting}
                idleLabel="Створити"
                loadingLabel="Створюємо..."
                className="w-full rounded-lg bg-pine px-4 py-2 font-semibold text-white"
              />
            </div>
          </form>
        </Panel>
      )}
      <Panel title="Групи, що навчалися у періоді">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
          <FormField label="Дата з" helperText="Початок періоду">
            <input
              type="date"
              className={formControlClass}
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </FormField>
          <FormField label="Дата по" helperText="Кінець періоду">
            <input
              type="date"
              className={formControlClass}
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </FormField>
          <div className="flex items-end">
            <button
              type="button"
              className="w-full rounded-lg bg-pine px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={isFiltering}
              onClick={loadActiveGroups}
            >
              {isFiltering ? "Шукаємо..." : "Показати"}
            </button>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              className="w-full rounded-lg border border-pine px-4 py-2 text-sm font-semibold text-pine hover:bg-emerald-50 disabled:opacity-50"
              disabled={isExporting}
              onClick={exportActiveGroups}
            >
              {isExporting ? "Готуємо..." : "Excel"}
            </button>
          </div>
        </div>
        <div className="mt-4">
          <DataTable
            data={activeGroups}
            columns={activeGroupColumns}
            rowKey={(group) => group.group_id}
            isLoading={isFiltering}
            errorText={filterError}
            onRetry={dateFrom && dateTo ? loadActiveGroups : null}
            emptyText="Оберіть дати та натисніть «Показати»"
            search={{
              placeholder: "Пошук за кодом, назвою або викладачем",
              getSearchText: (group) =>
                `${group.code} ${group.name} ${group.teachers.map((teacher) => teacher.teacher_name).join(" ")}`
            }}
          />
        </div>
      </Panel>
      <Panel title="Реєстр груп">
        <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
            onClick={loadGroups}
            disabled={isLoading}
          >
            {isLoading ? "Оновлюємо..." : "Оновити"}
          </button>
        </div>
        <DataTable
          data={groups}
          columns={columns}
          rowKey={(group) => group.id}
          isLoading={isLoading}
          errorText={loadError}
          onRetry={loadGroups}
          emptyText="Групи відсутні"
          search={{
            placeholder: "Пошук за кодом, назвою або статусом",
            getSearchText: (group) => `${group.code} ${group.name} ${group.status} ${formatGroupStatus(group.status)}`
          }}
        />
      </Panel>

      {/* Діалог підтвердження видалення групи */}
      {canEdit && (
        <ConfirmDialog
          open={deleteDialogOpen}
          title="Видалити групу"
          description={deleteDialogDescription}
          confirmLabel={isDeleting ? "Видаляємо..." : "Видалити"}
          cancelLabel="Скасувати"
          confirmVariant="danger"
          confirmDisabled={isDeleting}
          onConfirm={confirmDeleteGroup}
          onCancel={closeDeleteDialog}
        >
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              id="delete-trainees-checkbox"
              checked={deleteTrainees}
              onChange={(e) => setDeleteTrainees(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Також перемістити всіх слухачів групи до архіву
          </label>
        </ConfirmDialog>
      )}
    </div>
  );
}
