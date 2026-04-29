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
import type { ActiveGroupBetweenDates, CompletedGroupSummary, Group } from "../types/api";

export function GroupsPage() {
  const { request, user, accessToken } = useAuth();
  const { showError, showSuccess } = useToast();
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroups, setActiveGroups] = useState<ActiveGroupBetweenDates[]>([]);
  const [completedSummaries, setCompletedSummaries] = useState<CompletedGroupSummary[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [capacity, setCapacity] = useState(25);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [completedDateFrom, setCompletedDateFrom] = useState("");
  const [completedDateTo, setCompletedDateTo] = useState("");
  const [completedSearch, setCompletedSearch] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; code?: string; capacity?: string }>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isFiltering, setIsFiltering] = useState(false);
  const [isLoadingCompletedSummary, setIsLoadingCompletedSummary] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [completedSummaryError, setCompletedSummaryError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Record<number, boolean>>({});

  // --- Стан видалення групи ---
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<Group | null>(null);
  const [deleteTrainees, setDeleteTrainees] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [bulkDeleteTrainees, setBulkDeleteTrainees] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const canEdit = useMemo(
    () => user?.roles.some((role) => role.name === "admin" || role.name === "methodist") ?? false,
    [user]
  );

  const selectedGroups = useMemo(
    () => groups.filter((group) => selectedGroupIds[group.id]),
    [groups, selectedGroupIds]
  );

  const selectedGroupCount = selectedGroups.length;
  const allGroupsSelected = groups.length > 0 && groups.every((group) => selectedGroupIds[group.id]);

  const columns = useMemo<DataTableColumn<Group>[]>(
    () => [
      ...(canEdit
        ? [
            {
              key: "select" as const,
              header: "Вибір",
              render: (group: Group) => (
                <input
                  type="checkbox"
                  checked={Boolean(selectedGroupIds[group.id])}
                  onChange={() => toggleGroupSelection(group.id)}
                  aria-label={`Вибрати групу ${group.code}`}
                />
              )
            }
          ]
        : []),
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
    [canEdit, selectedGroupIds]
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

  const completedSummaryColumns = useMemo<DataTableColumn<CompletedGroupSummary>[]>(
    () => [
      {
        key: "name",
        header: "Назва / напрямок",
        render: (item) => item.name,
        sortAccessor: (item) => item.name
      },
      {
        key: "completed_count",
        header: "Проведено груп",
        render: (item) => <span className="font-semibold text-pine">{item.completed_count}</span>,
        sortAccessor: (item) => item.completed_count
      },
      {
        key: "period",
        header: "Період завершення",
        render: (item) =>
          item.first_completed_date && item.last_completed_date
            ? `${item.first_completed_date} — ${item.last_completed_date}`
            : "Без дати завершення",
        sortAccessor: (item) => item.last_completed_date || ""
      },
      {
        key: "group_codes",
        header: "Коди груп",
        render: (item) => item.group_codes.join(", "),
        sortAccessor: (item) => item.group_codes.join(" ")
      }
    ],
    []
  );

  const completedSummaryTotal = useMemo(
    () => completedSummaries.reduce((total, item) => total + item.completed_count, 0),
    [completedSummaries]
  );

  const loadGroups = async () => {
    setIsLoading(true);
    try {
      const data = await request<Group[]>("/groups");
      setGroups(data);
      setSelectedGroupIds((prev) => {
        const availableIds = new Set(data.map((group) => group.id));
        return Object.fromEntries(
          Object.entries(prev)
            .filter(([id, selected]) => selected && availableIds.has(Number(id)))
            .map(([id]) => [Number(id), true])
        );
      });
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
    loadCompletedSummary();
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

  const validateCompletedSummaryPeriod = () => {
    if (completedDateFrom && completedDateTo && completedDateTo < completedDateFrom) {
      return "Дата завершення має бути не раніше дати початку";
    }
    return null;
  };

  const loadCompletedSummary = async (showToast = false) => {
    const validationMessage = validateCompletedSummaryPeriod();
    if (validationMessage) {
      setCompletedSummaryError(validationMessage);
      showError(validationMessage);
      return;
    }
    setIsLoadingCompletedSummary(true);
    try {
      const params = new URLSearchParams();
      if (completedDateFrom) params.set("date_from", completedDateFrom);
      if (completedDateTo) params.set("date_to", completedDateTo);
      if (completedSearch.trim()) params.set("search", completedSearch.trim());
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const data = await request<CompletedGroupSummary[]>(`/groups/completed-summary${suffix}`);
      setCompletedSummaries(data);
      setCompletedSummaryError(null);
      if (showToast) {
        const totalCompleted = data.reduce((total, item) => total + item.completed_count, 0);
        showSuccess(data.length ? `Напрямків: ${data.length}, проведено груп: ${totalCompleted}` : "Проведених груп не знайдено");
      }
    } catch (error) {
      const message = (error as Error).message;
      setCompletedSummaryError(message);
      showError(message);
    } finally {
      setIsLoadingCompletedSummary(false);
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

  const toggleGroupSelection = (groupId: number) => {
    setSelectedGroupIds((prev) => {
      const next = { ...prev };
      if (next[groupId]) {
        delete next[groupId];
      } else {
        next[groupId] = true;
      }
      return next;
    });
  };

  const toggleAllGroups = () => {
    if (allGroupsSelected) {
      setSelectedGroupIds({});
      return;
    }
    setSelectedGroupIds(Object.fromEntries(groups.map((group) => [group.id, true])));
  };

  const openBulkDeleteDialog = () => {
    if (!selectedGroupCount) {
      showError("Виберіть хоча б одну групу");
      return;
    }
    setBulkDeleteTrainees(false);
    setBulkDeleteDialogOpen(true);
  };

  const closeBulkDeleteDialog = () => {
    if (isBulkDeleting) return;
    setBulkDeleteDialogOpen(false);
    setBulkDeleteTrainees(false);
  };

  const confirmBulkDeleteGroups = async () => {
    if (!selectedGroupCount || isBulkDeleting) return;
    setIsBulkDeleting(true);
    const failures: string[] = [];
    const deletedIds: number[] = [];
    try {
      const params = bulkDeleteTrainees ? "?delete_trainees=true" : "";
      for (const group of selectedGroups) {
        try {
          await request(`/groups/${group.id}${params}`, { method: "DELETE" });
          deletedIds.push(group.id);
        } catch (error) {
          failures.push(`${group.code}: ${(error as Error).message}`);
        }
      }
      setSelectedGroupIds((prev) => {
        const next = { ...prev };
        deletedIds.forEach((id) => delete next[id]);
        return next;
      });
      await loadGroups();
      if (failures.length) {
        showError(`Не вдалося видалити груп: ${failures.length}. ${failures[0]}`);
      } else {
        const suffix = bulkDeleteTrainees ? " разом зі слухачами" : "";
        showSuccess(`Видалено груп: ${deletedIds.length}${suffix}`);
        closeBulkDeleteDialog();
      }
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const deleteDialogDescription = groupToDelete
    ? `Видалити групу «${groupToDelete.code} — ${groupToDelete.name}»? Цю дію не можна скасувати.`
    : "";

  const bulkDeleteDescription = selectedGroupCount
    ? `Видалити вибрані групи (${selectedGroupCount})? Цю дію не можна скасувати.`
    : "Виберіть групи для видалення.";

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
      <Panel title="Проведені групи за напрямками">
        <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_1fr_auto]">
          <FormField label="Назва / напрямок" helperText="Можна залишити порожнім">
            <input
              className={formControlClass}
              placeholder="Наприклад: Штучний інтелект"
              value={completedSearch}
              onChange={(event) => setCompletedSearch(event.target.value)}
            />
          </FormField>
          <FormField label="Завершено з" helperText="Початок періоду">
            <input
              type="date"
              className={formControlClass}
              value={completedDateFrom}
              onChange={(event) => setCompletedDateFrom(event.target.value)}
            />
          </FormField>
          <FormField label="Завершено по" helperText="Кінець періоду">
            <input
              type="date"
              className={formControlClass}
              value={completedDateTo}
              onChange={(event) => setCompletedDateTo(event.target.value)}
            />
          </FormField>
          <div className="flex items-end">
            <button
              type="button"
              className="w-full rounded-lg bg-pine px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={isLoadingCompletedSummary}
              onClick={() => loadCompletedSummary(true)}
            >
              {isLoadingCompletedSummary ? "Рахуємо..." : "Порахувати"}
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-700">
          <span className="rounded-md bg-slate-100 px-2 py-1 font-semibold">Напрямків: {completedSummaries.length}</span>
          <span className="rounded-md bg-slate-100 px-2 py-1 font-semibold">Проведено груп: {completedSummaryTotal}</span>
        </div>
        <div className="mt-4">
          <DataTable
            data={completedSummaries}
            columns={completedSummaryColumns}
            rowKey={(item) => item.name}
            isLoading={isLoadingCompletedSummary}
            errorText={completedSummaryError}
            onRetry={() => loadCompletedSummary(true)}
            emptyText="Проведених груп не знайдено"
            search={{
              placeholder: "Пошук у результатах за назвою або кодом",
              getSearchText: (item) => `${item.name} ${item.group_codes.join(" ")}`
            }}
          />
        </div>
      </Panel>
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50"
                onClick={toggleAllGroups}
                disabled={!groups.length}
              >
                {allGroupsSelected ? "Зняти вибір" : "Вибрати всі"}
              </button>
              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                Вибрано: {selectedGroupCount}
              </span>
              <button
                type="button"
                className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={openBulkDeleteDialog}
                disabled={!selectedGroupCount || isBulkDeleting}
              >
                Видалити вибрані
              </button>
            </div>
          ) : (
            <div />
          )}
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
      {canEdit && (
        <ConfirmDialog
          open={bulkDeleteDialogOpen}
          title="Видалити вибрані групи"
          description={bulkDeleteDescription}
          confirmLabel={isBulkDeleting ? "Видаляємо..." : "Видалити"}
          cancelLabel="Скасувати"
          confirmVariant="danger"
          confirmDisabled={isBulkDeleting || !selectedGroupCount}
          onConfirm={confirmBulkDeleteGroups}
          onCancel={closeBulkDeleteDialog}
        >
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={bulkDeleteTrainees}
              onChange={(e) => setBulkDeleteTrainees(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Також перемістити всіх слухачів вибраних груп до архіву
          </label>
          {selectedGroups.length > 0 && (
            <p className="mt-2 text-xs text-slate-600">
              Групи: {selectedGroups.slice(0, 5).map((group) => group.code).join(", ")}
              {selectedGroups.length > 5 ? ` та ще ${selectedGroups.length - 5}` : ""}
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
