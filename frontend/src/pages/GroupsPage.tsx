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
import type { ActiveGroupBetweenDates, Group, GroupAuditLog, ScheduleSlot, Trainee } from "../types/api";

type GroupDetail = {
  activeTrainees: number;
  archivedTrainees: number;
  capacityUsedPct: number;
  scheduleSlots: number;
  scheduleHours: number;
  scheduleDateFrom: string | null;
  scheduleDateTo: string | null;
  teachers: GroupDetailTeacher[];
};

type GroupDetailTeacher = {
  teacherId: number;
  name: string;
  hours: number;
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("uk-UA");
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("uk-UA");
}

function formatHours(value: number): string {
  return value.toLocaleString("uk-UA", { maximumFractionDigits: 2 });
}

function formatAuditAction(action: string): string {
  if (action === "group.create") return "Групу створено";
  if (action === "group.update") return "Групу оновлено";
  if (action === "group.delete") return "Групу видалено";
  if (action === "group.enroll") return "Слухача зараховано";
  if (action === "group.expel") return "Слухача відраховано";
  return action;
}

function formatAuditDetails(details: Record<string, unknown> | null): string {
  if (!details) return "";
  const parts: string[] = [];
  if (typeof details.trainee_id === "number") parts.push(`слухач #${details.trainee_id}`);
  if (typeof details.reason === "string" && details.reason.trim()) parts.push(`причина: ${details.reason}`);
  if (typeof details.deleted_trainees_count === "number") parts.push(`видалено слухачів: ${details.deleted_trainees_count}`);
  if (typeof details.deleted_schedule_slots === "number") parts.push(`видалено занять: ${details.deleted_schedule_slots}`);
  if (typeof details.cleared_trainee_group_codes === "number") parts.push(`очищено кодів групи: ${details.cleared_trainee_group_codes}`);
  return parts.join(", ");
}

function buildGroupDetail(group: Group | null, trainees: Trainee[], scheduleSlots: ScheduleSlot[]): GroupDetail | null {
  if (!group) return null;
  const groupCode = group.code.trim();
  const groupTrainees = trainees.filter((trainee) => (trainee.group_code || "").trim() === groupCode);
  const groupSlots = scheduleSlots.filter((slot) => slot.group_id === group.id);
  const activeTrainees = groupTrainees.filter((trainee) => !trainee.is_deleted).length;
  const archivedTrainees = groupTrainees.length - activeTrainees;
  const capacityUsedPct = group.capacity > 0 ? Math.round((activeTrainees / group.capacity) * 100) : 0;
  const scheduleDates = groupSlots.map((slot) => slot.starts_at).filter(Boolean).sort();
  const teacherBuckets = new Map<number, GroupDetailTeacher>();
  groupSlots.forEach((slot) => {
    const name = (slot.teacher_name || "").trim();
    if (!name) return;
    const existing = teacherBuckets.get(slot.teacher_id);
    const nextHours = (existing?.hours || 0) + (slot.academic_hours || 0);
    teacherBuckets.set(slot.teacher_id, {
      teacherId: slot.teacher_id,
      name: existing && existing.name.length >= name.length ? existing.name : name,
      hours: Number(nextHours.toFixed(2))
    });
  });
  const teachers = Array.from(teacherBuckets.values()).sort((left, right) =>
    left.name.localeCompare(right.name, "uk-UA", { sensitivity: "base" })
  );

  return {
    activeTrainees,
    archivedTrainees,
    capacityUsedPct,
    scheduleSlots: groupSlots.length,
    scheduleHours: Number(groupSlots.reduce((sum, slot) => sum + (slot.academic_hours || 0), 0).toFixed(1)),
    scheduleDateFrom: scheduleDates[0] || null,
    scheduleDateTo: scheduleDates[scheduleDates.length - 1] || null,
    teachers
  };
}

export function GroupsPage() {
  const { request, user, accessToken } = useAuth();
  const { showError, showSuccess } = useToast();
  const [groups, setGroups] = useState<Group[]>([]);
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [scheduleSlots, setScheduleSlots] = useState<ScheduleSlot[]>([]);
  const [activeGroups, setActiveGroups] = useState<ActiveGroupBetweenDates[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [capacity, setCapacity] = useState(25);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [activeGroupSearch, setActiveGroupSearch] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; code?: string; capacity?: string }>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isFiltering, setIsFiltering] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Record<number, boolean>>({});
  const [selectedDetailGroupId, setSelectedDetailGroupId] = useState<number | null>(null);
  const [groupAudit, setGroupAudit] = useState<GroupAuditLog[]>([]);

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
  const selectedDetailGroup = useMemo(
    () => groups.find((group) => group.id === selectedDetailGroupId) || groups[0] || null,
    [groups, selectedDetailGroupId]
  );
  const selectedGroupDetail = useMemo(
    () => buildGroupDetail(selectedDetailGroup, trainees, scheduleSlots),
    [scheduleSlots, selectedDetailGroup, trainees]
  );

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
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-pine px-3 py-1 text-xs font-semibold text-pine hover:bg-emerald-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedDetailGroupId(group.id);
                    }}
                  >
                    Деталі
                  </button>
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
                </div>
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

  const loadGroups = async () => {
    setIsLoading(true);
    try {
      const [data, traineeRows, scheduleRows] = await Promise.all([
        request<Group[]>("/groups"),
        request<Trainee[]>("/trainees?include_deleted=true"),
        request<ScheduleSlot[]>("/schedule")
      ]);
      setGroups(data);
      setTrainees(traineeRows);
      setScheduleSlots(scheduleRows);
      setSelectedGroupIds((prev) => {
        const availableIds = new Set(data.map((group) => group.id));
        return Object.fromEntries(
          Object.entries(prev)
            .filter(([id, selected]) => selected && availableIds.has(Number(id)))
            .map(([id]) => [Number(id), true])
        );
      });
      setSelectedDetailGroupId((current) => {
        if (current && data.some((group) => group.id === current)) return current;
        return data[0]?.id ?? null;
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
  }, []);

  const loadGroupAudit = async (groupId: number) => {
    setIsAuditLoading(true);
    try {
      const data = await request<GroupAuditLog[]>(`/groups/${groupId}/audit?limit=12`);
      setGroupAudit(data);
      setAuditError(null);
    } catch (error) {
      const message = (error as Error).message;
      setGroupAudit([]);
      setAuditError(message);
    } finally {
      setIsAuditLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedDetailGroup) {
      setGroupAudit([]);
      return;
    }
    loadGroupAudit(selectedDetailGroup.id);
  }, [selectedDetailGroup?.id]);

  usePageRefresh(loadGroups);

  const validatePeriod = () => {
    if (dateFrom && dateTo && dateTo < dateFrom) {
      return "Дата завершення має бути не раніше дати початку";
    }
    return null;
  };

  const buildActiveGroupParams = () => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    const search = activeGroupSearch.trim();
    if (search) params.set("search", search);
    return params.toString();
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
      const params = buildActiveGroupParams();
      const data = await request<ActiveGroupBetweenDates[]>(`/groups/active-between${params ? `?${params}` : ""}`);
      setActiveGroups(data);
      setFilterError(null);
      showSuccess(data.length ? `Знайдено груп: ${data.length}` : "Груп не знайдено");
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
      const params = buildActiveGroupParams();
      const response = await fetch(`${API_URL}/groups/active-between/export${params ? `?${params}` : ""}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!response.ok) {
        throw new Error(`Не вдалося сформувати Excel (${response.status})`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const fileNameMatch = disposition.match(/filename="?([^"]+)"?/i);
      const fileName = fileNameMatch?.[1] || `groups_${dateFrom || "all"}_${dateTo || "all"}.xlsx`;
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
      <Panel title="Групи, що навчалися у періоді">
        <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_1fr_auto_auto]">
          <FormField label="Пошук групи" helperText="Код або частина назви">
            <input
              className={formControlClass}
              placeholder="Наприклад: трудових відносин"
              value={activeGroupSearch}
              onChange={(event) => setActiveGroupSearch(event.target.value)}
            />
          </FormField>
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
            onRetry={loadActiveGroups}
            emptyText="Вкажіть фільтри або залиште поля порожніми та натисніть «Показати»"
            emptyActionLabel="Показати всі групи"
            onEmptyAction={loadActiveGroups}
            emptyActionDisabled={isFiltering}
            search={{
              placeholder: "Пошук у результатах за кодом, назвою або викладачем",
              getSearchText: (group) =>
                `${group.code} ${group.name} ${group.teachers.map((teacher) => teacher.teacher_name).join(" ")}`
            }}
          />
        </div>
      </Panel>
      <Panel title="1.3 Детальна картка групи">
        {selectedDetailGroup && selectedGroupDetail ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Вибрана група</p>
                  <h3 className="mt-1 text-lg font-semibold text-ink">
                    {selectedDetailGroup.code} — {selectedDetailGroup.name}
                  </h3>
                </div>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                  {formatGroupStatus(selectedDetailGroup.status)}
                </span>
              </div>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Початок</dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-800">{formatDate(selectedDetailGroup.start_date)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Завершення</dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-800">{formatDate(selectedDetailGroup.end_date)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Місткість</dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-800">
                    {selectedGroupDetail.activeTrainees} / {selectedDetailGroup.capacity} ({selectedGroupDetail.capacityUsedPct}%)
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Архів слухачів</dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-800">{selectedGroupDetail.archivedTrainees}</dd>
                </div>
              </dl>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Занять у розкладі</p>
                <p className="mt-2 text-2xl font-semibold text-ink">{selectedGroupDetail.scheduleSlots}</p>
                <p className="mt-1 text-xs text-slate-600">Годин: {selectedGroupDetail.scheduleHours}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Період розкладу</p>
                <p className="mt-2 text-sm font-semibold text-ink">
                  {formatDate(selectedGroupDetail.scheduleDateFrom)} — {formatDate(selectedGroupDetail.scheduleDateTo)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Викладачі</p>
                <p className="mt-2 text-2xl font-semibold text-ink">{selectedGroupDetail.teachers.length}</p>
                {selectedGroupDetail.teachers.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-sm leading-5 text-slate-700">
                    {selectedGroupDetail.teachers.map((teacher) => (
                      <li key={teacher.teacherId} className="break-words">
                        {teacher.name}{" "}
                        <span className="font-semibold text-ink">({formatHours(teacher.hours)} год)</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-slate-600">Не знайдено</p>
                )}
              </div>
            </div>
            <div className="xl:col-span-2">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">1.2 Історія дій</p>
                    <h4 className="mt-1 text-sm font-semibold text-ink">Останні зміни по групі</h4>
                  </div>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"
                    onClick={() => loadGroupAudit(selectedDetailGroup.id)}
                    disabled={isAuditLoading}
                  >
                    {isAuditLoading ? "Оновлюємо..." : "Оновити історію"}
                  </button>
                </div>
                {auditError && <p className="mt-3 text-sm text-rose-700">{auditError}</p>}
                {!auditError && !isAuditLoading && groupAudit.length === 0 && (
                  <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    Дій по цій групі ще не знайдено.
                  </p>
                )}
                <div className="mt-3 space-y-2">
                  {groupAudit.map((item) => {
                    const details = formatAuditDetails(item.details);
                    return (
                      <article key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-ink">{formatAuditAction(item.action)}</p>
                            {details && <p className="mt-1 text-xs text-slate-600">{details}</p>}
                          </div>
                          <p className="text-right text-xs text-slate-500">
                            {formatDateTime(item.created_at)}
                            <br />
                            {item.actor_name || "Система"}
                          </p>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
            Групу для перегляду ще не вибрано.
          </div>
        )}
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
          rowClassName={(group) => (group.id === selectedDetailGroup?.id ? "bg-emerald-50" : undefined)}
          emptyText="Групи відсутні"
          emptyActionLabel="Оновити реєстр"
          onEmptyAction={loadGroups}
          emptyActionDisabled={isLoading}
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
