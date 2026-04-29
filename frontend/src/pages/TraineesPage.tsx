import { FormEvent, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FormField, FormSubmitButton, formControlClass } from "../components/FormField";
import { InlineNotice } from "../components/InlineNotice";
import { Panel } from "../components/Panel";
import { StickyActionBar } from "../components/StickyActionBar";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { usePageRefresh } from "../hooks/usePageRefresh";
import type { Trainee, Group } from "../types/api";

type TraineeEditForm = {
  first_name: string;
  last_name: string;
  source_row_number: string;
  employment_center: string;
  birth_date: string;
  contract_number: string;
  certificate_number: string;
  certificate_issue_date: string;
  postal_index: string;
  address: string;
  passport_series: string;
  passport_number: string;
  passport_issued_by: string;
  passport_issued_date: string;
  tax_id: string;
  phone: string;
  group_code: string;
  status: string;
};

type BulkGroupUpdateResponse = {
  updated_count: number;
  updated_ids: number[];
  group_code: string | null;
};

type BulkStatusUpdateResponse = {
  updated_count: number;
  updated_ids: number[];
  status: "active" | "completed" | "expelled";
};

type BulkDeleteResponse = {
  deleted_count: number;
  deleted_ids: number[];
};

type BulkRestoreResponse = {
  restored_count: number;
  restored_ids: number[];
};

type ClearOrphanGroupsResponse = {
  cleared_count: number;
  cleared_ids: number[];
};

type TraineeProblemFilter = "all" | "unassigned" | "orphan_group" | "archived";

const TRAINEE_STATUS_OPTIONS = [
  { value: "active", label: "Активний" },
  { value: "completed", label: "Завершив навчання" },
  { value: "expelled", label: "Відрахований" }
] as const;
const PROBLEM_FILTERS: Array<{ value: TraineeProblemFilter; label: string }> = [
  { value: "all", label: "Усі" },
  { value: "unassigned", label: "Без групи" },
  { value: "orphan_group", label: "Невідомі групи" },
  { value: "archived", label: "Архів" }
];
const TRAINEE_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  TRAINEE_STATUS_OPTIONS.map((item) => [item.value, item.label])
);

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("uk-UA");
}

function toInputDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function buildDisplayName(trainee: Trainee): string {
  return `${trainee.last_name} ${trainee.first_name}`.trim();
}

function resolveGroupBucket(groupCode: string | null | undefined): { key: string; label: string } {
  const normalized = (groupCode || "").trim();
  if (!normalized) {
    return { key: "__no_group__", label: "Без призначеної групи" };
  }
  return { key: normalized, label: normalized };
}

function toEditForm(trainee: Trainee): TraineeEditForm {
  return {
    first_name: trainee.first_name || "",
    last_name: trainee.last_name || "",
    source_row_number: trainee.source_row_number ? String(trainee.source_row_number) : "",
    employment_center: trainee.employment_center || "",
    birth_date: toInputDate(trainee.birth_date),
    contract_number: trainee.contract_number || "",
    certificate_number: trainee.certificate_number || "",
    certificate_issue_date: toInputDate(trainee.certificate_issue_date),
    postal_index: trainee.postal_index || "",
    address: trainee.address || "",
    passport_series: trainee.passport_series || "",
    passport_number: trainee.passport_number || "",
    passport_issued_by: trainee.passport_issued_by || "",
    passport_issued_date: toInputDate(trainee.passport_issued_date),
    tax_id: trainee.tax_id || "",
    phone: trainee.phone || "",
    group_code: trainee.group_code || "",
    status: trainee.status || "active"
  };
}

export function TraineesPage() {
  const { request, user } = useAuth();
  const { showError, showSuccess } = useToast();
  
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [groupCode, setGroupCode] = useState("");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [problemFilter, setProblemFilter] = useState<TraineeProblemFilter>("all");
  const [createErrors, setCreateErrors] = useState<{ firstName?: string; lastName?: string }>({});
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [bulkGroupCode, setBulkGroupCode] = useState("");
  const [bulkStatus, setBulkStatus] = useState<"active" | "completed" | "expelled">("active");
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState<TraineeEditForm | null>(null);
  const [editErrors, setEditErrors] = useState<{ firstName?: string; lastName?: string; sourceRowNumber?: string }>({});
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archiveTargetIds, setArchiveTargetIds] = useState<number[]>([]);

  const canEdit = useMemo(
    () => user?.roles.some((role) => role.name === "admin" || role.name === "methodist") ?? false,
    [user]
  );

  const sortedTrainees = useMemo(
    () =>
      [...trainees].sort((a, b) => {
        const numA = a.source_row_number ?? Number.MAX_SAFE_INTEGER;
        const numB = b.source_row_number ?? Number.MAX_SAFE_INTEGER;
        if (numA !== numB) return numA - numB;
        return buildDisplayName(a).localeCompare(buildDisplayName(b), "uk");
      }),
    [trainees]
  );

  const validGroupCodes = useMemo(
    () => new Set(groups.map((group) => (group.code || "").trim()).filter(Boolean)),
    [groups]
  );

  const problemCounts = useMemo(
    () => ({
      all: sortedTrainees.length,
      unassigned: sortedTrainees.filter((item) => !item.is_deleted && !(item.group_code || "").trim()).length,
      orphan_group: sortedTrainees.filter((item) => {
        const code = (item.group_code || "").trim();
        return !item.is_deleted && Boolean(code) && !validGroupCodes.has(code);
      }).length,
      archived: sortedTrainees.filter((item) => item.is_deleted).length
    }),
    [sortedTrainees, validGroupCodes]
  );

  const filteredTrainees = useMemo(
    () =>
      sortedTrainees.filter((trainee) => {
        const code = (trainee.group_code || "").trim();
        if (problemFilter === "unassigned") return !trainee.is_deleted && !code;
        if (problemFilter === "orphan_group") return !trainee.is_deleted && Boolean(code) && !validGroupCodes.has(code);
        if (problemFilter === "archived") return trainee.is_deleted;
        return true;
      }),
    [problemFilter, sortedTrainees, validGroupCodes]
  );

  const groupedTrainees = useMemo(() => {
    const buckets = new Map<string, { key: string; label: string; trainees: Trainee[] }>();
    for (const trainee of filteredTrainees) {
      const bucket = resolveGroupBucket(trainee.group_code);
      const existing = buckets.get(bucket.key);
      if (existing) {
        existing.trainees.push(trainee);
        continue;
      }
      buckets.set(bucket.key, { key: bucket.key, label: bucket.label, trainees: [trainee] });
    }
    const groups = [...buckets.values()];
    groups.sort((a, b) => {
      if (a.key === "__no_group__") return 1;
      if (b.key === "__no_group__") return -1;
      return a.label.localeCompare(b.label, "uk", { numeric: true, sensitivity: "base" });
    });
    return groups;
  }, [filteredTrainees]);

  const rowNumberById = useMemo(() => {
    const entries: Record<number, number> = {};
    filteredTrainees.forEach((trainee, idx) => {
      entries[trainee.id] = trainee.source_row_number ?? idx + 1;
    });
    return entries;
  }, [filteredTrainees]);

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, checked]) => checked).map(([id]) => Number(id)),
    [selected]
  );

  const selectedActiveIds = useMemo(
    () =>
      selectedIds.filter((id) => {
        const trainee = trainees.find((item) => item.id === id);
        return trainee ? !trainee.is_deleted : false;
      }),
    [selectedIds, trainees]
  );

  const selectedArchivedIds = useMemo(
    () =>
      selectedIds.filter((id) => {
        const trainee = trainees.find((item) => item.id === id);
        return trainee ? trainee.is_deleted : false;
      }),
    [selectedIds, trainees]
  );

  const fetchTrainees = async (term = "") => {
    setIsLoading(true);
    try {
      const [groupsData, data] = await Promise.all([
        request<Group[]>("/groups"),
        (async () => {
          const params = new URLSearchParams();
          if (term.trim()) {
            params.set("search", term.trim());
          }
          if (showArchived || problemFilter === "archived") {
            params.set("include_deleted", "true");
          }
          const query = params.toString() ? `?${params.toString()}` : "";
          return request<Trainee[]>(`/trainees${query}`);
        })()
      ]);
      setGroups(groupsData);
      setTrainees(data);
      setSelected((prev) => {
        const next: Record<number, boolean> = {};
        for (const trainee of data) {
          if (prev[trainee.id]) next[trainee.id] = true;
        }
        return next;
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
    fetchTrainees(search);
  }, [showArchived, problemFilter]);

  usePageRefresh(() => fetchTrainees(search), {
    enabled: !editingId && !isSavingEdit && !isSubmitting && !isBulkUpdating
  });

  
  const [groupToDelete, setGroupToDelete] = useState<Group | null>(null);

  const confirmDeleteGroup = async () => {
    if (!groupToDelete) return;
    try {
      await request(`/groups/${groupToDelete.id}?delete_trainees=true`, { method: "DELETE" });
      setGroupToDelete(null);
      showSuccess("Групу та її слухачів успішно видалено");
      fetchTrainees(search);
    } catch (error) {
      showError((error as Error).message);
    }
  };

  const handleGroupDeleteClick = (groupCode: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const groupObj = groups.find(g => g.code === groupCode);
    if (groupObj) {
      setGroupToDelete(groupObj);
    } else {
      showError("Групу не знайдено в базі даних (можливо, це віртуальна група).");
    }
  };

  const createTrainee = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit) return;
    const nextErrors: { firstName?: string; lastName?: string } = {};
    if (!firstName.trim()) nextErrors.firstName = "Вкажіть ім'я";
    if (!lastName.trim()) nextErrors.lastName = "Вкажіть прізвище";
    if (Object.keys(nextErrors).length) {
      setCreateErrors(nextErrors);
      showError(Object.values(nextErrors)[0]);
      return;
    }
    setCreateErrors({});
    setIsSubmitting(true);
    try {
      await request("/trainees", {
        method: "POST",
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: phone || null,
          group_code: groupCode || null,
          status: "active"
        })
      });
      setFirstName("");
      setLastName("");
      setPhone("");
      setGroupCode("");
      setCreateErrors({});
      await fetchTrainees(search);
      showSuccess("Слухача додано");
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleExpanded = (id: number) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleGroupExpanded = (groupKey: string) => {
    setExpandedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  const expandAll = () => {
    const next: Record<number, boolean> = {};
    for (const trainee of filteredTrainees) next[trainee.id] = true;
    setExpanded(next);
    const nextGroups: Record<string, boolean> = {};
    for (const group of groupedTrainees) nextGroups[group.key] = true;
    setExpandedGroups(nextGroups);
  };

  const collapseAll = () => {
    setExpanded({});
    setExpandedGroups({});
  };

  const toggleSelected = (id: number) => {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectAllVisible = () => {
    const next: Record<number, boolean> = {};
    for (const trainee of filteredTrainees) next[trainee.id] = true;
    setSelected(next);
  };

  const clearSelection = () => setSelected({});

  const runBulkGroupUpdate = async (targetGroupCode: string | null) => {
    if (!selectedActiveIds.length) {
      showError("Виберіть щонайменше одного активного слухача");
      return;
    }
    setIsBulkUpdating(true);
    try {
      const payload = {
        trainee_ids: selectedActiveIds,
        group_code: targetGroupCode
      };
      const response = await request<BulkGroupUpdateResponse>("/trainees/bulk/group-code", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      await fetchTrainees(search);
      clearSelection();
      setBulkGroupCode("");
      showSuccess(`Оновлено слухачів: ${response.updated_count}`);
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const runBulkStatusUpdate = async (targetStatus: "active" | "completed" | "expelled") => {
    if (!selectedActiveIds.length) {
      showError("Виберіть щонайменше одного активного слухача");
      return;
    }
    setIsBulkUpdating(true);
    try {
      const payload = {
        trainee_ids: selectedActiveIds,
        status: targetStatus
      };
      const response = await request<BulkStatusUpdateResponse>("/trainees/bulk/status", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      await fetchTrainees(search);
      clearSelection();
      const statusLabel = TRAINEE_STATUS_LABELS[response.status] || response.status;
      showSuccess(`Оновлено статус (${statusLabel}) для ${response.updated_count} слухачів`);
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const openBulkArchiveDialog = () => {
    if (!selectedActiveIds.length) {
      showError("Виберіть щонайменше одного активного слухача");
      return;
    }
    setArchiveTargetIds(selectedActiveIds);
    setArchiveDialogOpen(true);
  };

  const closeBulkArchiveDialog = () => {
    if (isBulkUpdating) return;
    setArchiveDialogOpen(false);
    setArchiveTargetIds([]);
  };

  const runBulkDelete = async () => {
    if (isBulkUpdating) return;
    if (!archiveTargetIds.length) {
      closeBulkArchiveDialog();
      return;
    }
    setIsBulkUpdating(true);
    try {
      const response = await request<BulkDeleteResponse>("/trainees/bulk/delete", {
        method: "POST",
        body: JSON.stringify({ trainee_ids: archiveTargetIds })
      });
      await fetchTrainees(search);
      clearSelection();
      showSuccess(`Архівовано слухачів: ${response.deleted_count}`);
      closeBulkArchiveDialog();
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const runBulkRestore = async () => {
    if (!selectedArchivedIds.length) {
      showError("Виберіть щонайменше одного архівного слухача");
      return;
    }
    setIsBulkUpdating(true);
    try {
      const response = await request<BulkRestoreResponse>("/trainees/bulk/restore", {
        method: "POST",
        body: JSON.stringify({ trainee_ids: selectedArchivedIds })
      });
      await fetchTrainees(search);
      clearSelection();
      showSuccess(`Відновлено слухачів: ${response.restored_count}`);
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const runClearOrphanGroupCodes = async () => {
    if (!canEdit) return;
    const unassignedCount = trainees.filter((item) => !item.is_deleted && !(item.group_code || "").trim()).length;
    setIsBulkUpdating(true);
    try {
      const response = await request<ClearOrphanGroupsResponse>("/trainees/bulk/clear-orphan-group-codes", {
        method: "POST"
      });
      await fetchTrainees(search);
      if (response.cleared_count > 0) {
        showSuccess(`Очищено невідомі групи у слухачів: ${response.cleared_count}`);
      } else if (unassignedCount > 0) {
        showSuccess(`Невідомих кодів груп не знайдено. Слухачів без призначеної групи: ${unassignedCount}`);
      } else {
        showSuccess("Невідомих кодів груп не знайдено");
      }
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const runArchiveUnassignedGroup = async () => {
    if (!canEdit) return;
    setIsBulkUpdating(true);
    try {
      const response = await request<BulkDeleteResponse>("/trainees/bulk/archive-unassigned-group", {
        method: "POST"
      });
      await fetchTrainees(search);
      showSuccess(`Архівовано слухачів без призначеної групи: ${response.deleted_count}`);
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const startEdit = (trainee: Trainee) => {
    if (trainee.is_deleted) {
      showError("Слухач в архіві. Спочатку відновіть запис");
      return;
    }
    setEditingId(trainee.id);
    setEditForm(toEditForm(trainee));
    setEditErrors({});
    const bucket = resolveGroupBucket(trainee.group_code);
    setExpandedGroups((prev) => ({ ...prev, [bucket.key]: true }));
    setExpanded((prev) => ({ ...prev, [trainee.id]: true }));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(null);
    setEditErrors({});
  };

  const updateEditField = (field: keyof TraineeEditForm, value: string) => {
    setEditForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || !editingId || !editForm) return;
    const nextErrors: { firstName?: string; lastName?: string; sourceRowNumber?: string } = {};
    if (!editForm.first_name.trim()) nextErrors.firstName = "Вкажіть ім'я";
    if (!editForm.last_name.trim()) nextErrors.lastName = "Вкажіть прізвище";
    if (editForm.source_row_number.trim()) {
      const sourceRowNumber = Number(editForm.source_row_number);
      if (!Number.isFinite(sourceRowNumber) || sourceRowNumber < 1) {
        nextErrors.sourceRowNumber = "Номер рядка має бути цілим числом від 1";
      }
    }
    if (Object.keys(nextErrors).length) {
      setEditErrors(nextErrors);
      showError(Object.values(nextErrors)[0]);
      return;
    }
    setEditErrors({});
    setIsSavingEdit(true);
    try {
      const sourceRowNumber = editForm.source_row_number.trim() ? Number(editForm.source_row_number) : null;
      const payload = {
        first_name: editForm.first_name.trim(),
        last_name: editForm.last_name.trim(),
        source_row_number: sourceRowNumber,
        employment_center: editForm.employment_center || null,
        birth_date: editForm.birth_date || null,
        contract_number: editForm.contract_number || null,
        certificate_number: editForm.certificate_number || null,
        certificate_issue_date: editForm.certificate_issue_date || null,
        postal_index: editForm.postal_index || null,
        address: editForm.address || null,
        passport_series: editForm.passport_series || null,
        passport_number: editForm.passport_number || null,
        passport_issued_by: editForm.passport_issued_by || null,
        passport_issued_date: editForm.passport_issued_date || null,
        tax_id: editForm.tax_id || null,
        phone: editForm.phone || null,
        group_code: editForm.group_code || null,
        status: editForm.status || "active"
      };
      await request(`/trainees/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      await fetchTrainees(search);
      showSuccess("Дані слухача оновлено");
      cancelEdit();
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const archiveDialogDescription = useMemo(() => {
    if (!archiveTargetIds.length) return "Оберіть слухачів для архівування.";
    const targetRows = trainees.filter((item) => archiveTargetIds.includes(item.id));
    if (!targetRows.length) {
      return `Підтвердьте архівування ${archiveTargetIds.length} запис(ів).`;
    }
    const preview = targetRows
      .slice(0, 2)
      .map((item) => buildDisplayName(item))
      .join(", ");
    const hasMore = targetRows.length > 2 ? ` та ще ${targetRows.length - 2}` : "";
    return `Підтвердьте архівування: ${preview}${hasMore}.`;
  }, [archiveTargetIds, trainees]);

  return (
    <div className="space-y-5">
      <Panel title="Пошук слухачів">
        <StickyActionBar>
          <div className="flex flex-wrap gap-3">
            <FormField className="min-w-[240px] flex-1" label="Пошуковий запит">
              <input
                className={formControlClass}
                placeholder="ПІБ, номер групи, номер договору"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </FormField>
            <button className="rounded-lg bg-pine px-4 py-2 font-semibold text-white" onClick={() => fetchTrainees(search)}>
              Знайти
            </button>
            <button
              type="button"
              className="rounded-lg bg-amber px-4 py-2 font-semibold text-ink disabled:opacity-50"
              onClick={() => fetchTrainees(search)}
              disabled={isLoading}
            >
              {isLoading ? "Оновлюємо..." : "Оновити"}
            </button>
          </div>
        </StickyActionBar>
      </Panel>

      {canEdit && (
        <Panel title="Додати слухача вручну">
          <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={createTrainee}>
            <FormField label="Ім'я" required helperText="Ім'я слухача" errorText={createErrors.firstName}>
              <input
                className={formControlClass}
                value={firstName}
                onChange={(event) => {
                  setFirstName(event.target.value);
                  setCreateErrors((prev) => ({ ...prev, firstName: undefined }));
                }}
                required
              />
            </FormField>
            <FormField label="Прізвище" required helperText="Прізвище слухача" errorText={createErrors.lastName}>
              <input
                className={formControlClass}
                value={lastName}
                onChange={(event) => {
                  setLastName(event.target.value);
                  setCreateErrors((prev) => ({ ...prev, lastName: undefined }));
                }}
                required
              />
            </FormField>
            <FormField label="Телефон">
              <input className={formControlClass} value={phone} onChange={(event) => setPhone(event.target.value)} />
            </FormField>
            <div className="flex gap-2">
              <FormField className="flex-1" label="Номер групи">
                <input className={formControlClass} value={groupCode} onChange={(event) => setGroupCode(event.target.value)} />
              </FormField>
              <div className="flex items-end">
                <FormSubmitButton
                  isLoading={isSubmitting}
                  idleLabel="Додати"
                  loadingLabel="Додаємо..."
                  className="rounded-lg bg-pine px-4 py-2 font-semibold text-white"
                />
              </div>
            </div>
          </form>
        </Panel>
      )}

      <Panel title="Реєстр слухачів">
        {loadError && <InlineNotice className="mb-3" tone="error" text={loadError} />}
        <StickyActionBar className="mb-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
              {PROBLEM_FILTERS.map((item) => {
                const count = problemCounts[item.value];
                const active = problemFilter === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                      active ? "bg-pine text-white" : "text-slate-700 hover:bg-slate-100"
                    }`}
                    onClick={() => {
                      setProblemFilter(item.value);
                      if (item.value === "archived") {
                        setShowArchived(true);
                      }
                    }}
                  >
                    {item.label} <span className={active ? "text-white" : "text-slate-500"}>{count}</span>
                  </button>
                );
              })}
            </div>
            <label className="mr-2 flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
              />
              Показати архів
            </label>
            <button className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-800" onClick={expandAll}>
              Розгорнути всі
            </button>
            <button className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-800" onClick={collapseAll}>
              Згорнути всі
            </button>
            {canEdit && (
              <>
                <button className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-800" onClick={selectAllVisible}>
                  Вибрати всі
                </button>
                <button className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-800" onClick={clearSelection}>
                  Зняти вибір
                </button>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                  Вибрано: {selectedIds.length}
                </span>
                <input
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Номер групи"
                  value={bulkGroupCode}
                  onChange={(event) => setBulkGroupCode(event.target.value)}
                />
                <button
                  className="rounded-lg bg-pine px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  onClick={() => runBulkGroupUpdate(bulkGroupCode.trim() || null)}
                  disabled={isBulkUpdating || !selectedActiveIds.length}
                >
                  Призначити групу
                </button>
                <button
                  className="rounded-lg bg-amber px-3 py-2 text-sm font-semibold text-ink disabled:opacity-50"
                  onClick={() => runBulkGroupUpdate(null)}
                  disabled={isBulkUpdating || !selectedActiveIds.length}
                >
                  Очистити групу
                </button>
                <button
                  className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  onClick={runClearOrphanGroupCodes}
                  disabled={isBulkUpdating}
                >
                  Очистити невідомі групи
                </button>
                <button
                  className="rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  onClick={runArchiveUnassignedGroup}
                  disabled={isBulkUpdating}
                >
                  Архівувати без групи
                </button>
                <select
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={bulkStatus}
                  onChange={(event) => setBulkStatus(event.target.value as "active" | "completed" | "expelled")}
                >
                  {TRAINEE_STATUS_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <button
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  onClick={() => runBulkStatusUpdate(bulkStatus)}
                  disabled={isBulkUpdating || !selectedActiveIds.length}
                >
                  Змінити статус
                </button>
                <button
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  onClick={runBulkRestore}
                  disabled={isBulkUpdating || !selectedArchivedIds.length}
                >
                  Відновити вибраних
                </button>
                <button
                  className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  onClick={openBulkArchiveDialog}
                  disabled={isBulkUpdating || !selectedActiveIds.length}
                >
                  Архівувати вибраних
                </button>
              </>
            )}
          </div>
        </StickyActionBar>
        {isLoading && <p className="text-sm text-slate-600">Завантаження...</p>}
        {!isLoading && filteredTrainees.length === 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <p className="text-sm text-slate-600">За вибраним фільтром записів немає</p>
            <button
              type="button"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              onClick={() => {
                setProblemFilter("all");
                setShowArchived(false);
              }}
            >
              Показати всіх активних
            </button>
          </div>
        )}
        <div className="space-y-2">
          {groupedTrainees.map((group) => {
            const groupExpanded = Boolean(expandedGroups[group.key]);
            return (
              <section key={group.key} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 bg-slate-50 px-3 py-2 text-left"
                  onClick={() => toggleGroupExpanded(group.key)}
                  aria-expanded={groupExpanded}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {group.key === "__no_group__" ? group.label : `Група: ${group.label}`}
                    </p>
                    <p className="truncate text-xs text-slate-600">
                      Слухачів: {group.trainees.length}
                    </p>
                  </div>
                  <span className="text-xl leading-none text-slate-500">{groupExpanded ? "−" : "+"}</span>
                </button>
                {groupExpanded && (
                  <div className="space-y-2 border-t border-slate-200 px-3 py-3">
                    {group.trainees.map((trainee) => {
                      const isExpanded = Boolean(expanded[trainee.id]);
                      const isEditing = editingId === trainee.id;
                      const number = rowNumberById[trainee.id] ?? trainee.id;
                      const isSelected = Boolean(selected[trainee.id]);
                      const traineeGroupCode = (trainee.group_code || "").trim();
                      const hasUnknownGroup = Boolean(traineeGroupCode) && !validGroupCodes.has(traineeGroupCode);
                      return (
                        <article
                          key={trainee.id}
                          className={`overflow-hidden rounded-lg border bg-white ${
                            hasUnknownGroup || (!trainee.is_deleted && !traineeGroupCode)
                              ? "border-amber-300"
                              : "border-slate-200"
                          }`}
                        >
                          <div className="flex items-center gap-2 px-3 py-2">
                            {canEdit && (
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelected(trainee.id)}
                                aria-label={`Вибрати слухача ${buildDisplayName(trainee)}`}
                              />
                            )}
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-3 text-left"
                              onClick={() => toggleExpanded(trainee.id)}
                              aria-expanded={isExpanded}
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-900">
                                  {number}. {buildDisplayName(trainee)}
                                </p>
                                <p className="truncate text-xs text-slate-600">
                                  Номер групи: {trainee.group_code || "—"} · № договору: {trainee.contract_number || "—"}
                                </p>
                                <p className="truncate text-xs text-slate-600">
                                  Статус: {TRAINEE_STATUS_LABELS[trainee.status] || trainee.status}
                                </p>
                                {trainee.is_deleted && (
                                  <p className="mt-1 inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">
                                    В архіві
                                  </p>
                                )}
                                {!trainee.is_deleted && !traineeGroupCode && (
                                  <p className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                                    Без групи
                                  </p>
                                )}
                                {!trainee.is_deleted && hasUnknownGroup && (
                                  <p className="mt-1 inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
                                    Невідомий код групи
                                  </p>
                                )}
                              </div>
                              <span className="text-xl leading-none text-slate-500">{isExpanded ? "−" : "+"}</span>
                            </button>
                          </div>
                          {isExpanded && (
                            <div className="space-y-3 border-t border-slate-200 px-4 py-3 text-sm">
                              {!isEditing && (
                                <div className="grid gap-2 md:grid-cols-2">
                                  <p><span className="font-semibold">Номер:</span> {number}</p>
                                  <p><span className="font-semibold">Прізвище, ім'я, по батькові:</span> {buildDisplayName(trainee)}</p>
                                  <p><span className="font-semibold">Центр зайнятості:</span> {trainee.employment_center || "—"}</p>
                                  <p><span className="font-semibold">Дата народження:</span> {formatDate(trainee.birth_date)}</p>
                                  <p><span className="font-semibold">№ Договору:</span> {trainee.contract_number || "—"}</p>
                                  <p><span className="font-semibold">Сертифікат:</span> {trainee.certificate_number || "—"}</p>
                                  <p><span className="font-semibold">Дата видачі сертифікату:</span> {formatDate(trainee.certificate_issue_date)}</p>
                                  <p><span className="font-semibold">Індекс:</span> {trainee.postal_index || "—"}</p>
                                  <p className="md:col-span-2"><span className="font-semibold">Адреса:</span> {trainee.address || "—"}</p>
                                  <p><span className="font-semibold">Паспорт: СЕРІЯ:</span> {trainee.passport_series || "—"}</p>
                                  <p><span className="font-semibold">Паспорт: №:</span> {trainee.passport_number || "—"}</p>
                                  <p className="md:col-span-2"><span className="font-semibold">Ким виданий:</span> {trainee.passport_issued_by || "—"}</p>
                                  <p><span className="font-semibold">Коли виданий:</span> {formatDate(trainee.passport_issued_date)}</p>
                                  <p><span className="font-semibold">Ідентифікаційний код:</span> {trainee.tax_id || "—"}</p>
                                  <p><span className="font-semibold">Телефон:</span> {trainee.phone || "—"}</p>
                                  <p><span className="font-semibold">Номер групи:</span> {trainee.group_code || "—"}</p>
                                  <p><span className="font-semibold">Статус:</span> {TRAINEE_STATUS_LABELS[trainee.status] || trainee.status}</p>
                                </div>
                              )}

                              {canEdit && !isEditing && (
                                <div>
                                  {!trainee.is_deleted ? (
                                    <button
                                      type="button"
                                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                                      onClick={() => startEdit(trainee)}
                                    >
                                      Редагувати
                                    </button>
                                  ) : (
                                    <p className="text-xs font-semibold text-rose-700">Редагування недоступне для архівного запису</p>
                                  )}
                                </div>
                              )}

                              {canEdit && isEditing && editForm && (
                                <form className="grid gap-3 md:grid-cols-2" onSubmit={saveEdit}>
                                  <FormField label="Номер" errorText={editErrors.sourceRowNumber}>
                                    <input
                                      className={formControlClass}
                                      value={editForm.source_row_number}
                                      onChange={(event) => {
                                        updateEditField("source_row_number", event.target.value);
                                        setEditErrors((prev) => ({ ...prev, sourceRowNumber: undefined }));
                                      }}
                                    />
                                  </FormField>
                                  <FormField label="Номер групи">
                                    <input className={formControlClass} value={editForm.group_code} onChange={(event) => updateEditField("group_code", event.target.value)} />
                                  </FormField>
                                  <FormField label="Прізвище" required errorText={editErrors.lastName}>
                                    <input
                                      className={formControlClass}
                                      value={editForm.last_name}
                                      onChange={(event) => {
                                        updateEditField("last_name", event.target.value);
                                        setEditErrors((prev) => ({ ...prev, lastName: undefined }));
                                      }}
                                      required
                                    />
                                  </FormField>
                                  <FormField label="Ім'я та по батькові" required errorText={editErrors.firstName}>
                                    <input
                                      className={formControlClass}
                                      value={editForm.first_name}
                                      onChange={(event) => {
                                        updateEditField("first_name", event.target.value);
                                        setEditErrors((prev) => ({ ...prev, firstName: undefined }));
                                      }}
                                      required
                                    />
                                  </FormField>
                                  <FormField className="md:col-span-2" label="Центр зайнятості">
                                    <input className={formControlClass} value={editForm.employment_center} onChange={(event) => updateEditField("employment_center", event.target.value)} />
                                  </FormField>
                                  <FormField label="Дата народження">
                                    <input type="date" className={formControlClass} value={editForm.birth_date} onChange={(event) => updateEditField("birth_date", event.target.value)} />
                                  </FormField>
                                  <FormField label="№ Договору">
                                    <input className={formControlClass} value={editForm.contract_number} onChange={(event) => updateEditField("contract_number", event.target.value)} />
                                  </FormField>
                                  <FormField label="Сертифікат">
                                    <input className={formControlClass} value={editForm.certificate_number} onChange={(event) => updateEditField("certificate_number", event.target.value)} />
                                  </FormField>
                                  <FormField label="Дата видачі сертифікату">
                                    <input
                                      type="date"
                                      className={formControlClass}
                                      value={editForm.certificate_issue_date}
                                      onChange={(event) => updateEditField("certificate_issue_date", event.target.value)}
                                    />
                                  </FormField>
                                  <FormField label="Індекс">
                                    <input className={formControlClass} value={editForm.postal_index} onChange={(event) => updateEditField("postal_index", event.target.value)} />
                                  </FormField>
                                  <FormField className="md:col-span-2" label="Адреса">
                                    <input className={formControlClass} value={editForm.address} onChange={(event) => updateEditField("address", event.target.value)} />
                                  </FormField>
                                  <FormField label="Паспорт: СЕРІЯ">
                                    <input className={formControlClass} value={editForm.passport_series} onChange={(event) => updateEditField("passport_series", event.target.value)} />
                                  </FormField>
                                  <FormField label="Паспорт: №">
                                    <input className={formControlClass} value={editForm.passport_number} onChange={(event) => updateEditField("passport_number", event.target.value)} />
                                  </FormField>
                                  <FormField className="md:col-span-2" label="Ким виданий">
                                    <input className={formControlClass} value={editForm.passport_issued_by} onChange={(event) => updateEditField("passport_issued_by", event.target.value)} />
                                  </FormField>
                                  <FormField label="Коли виданий">
                                    <input
                                      type="date"
                                      className={formControlClass}
                                      value={editForm.passport_issued_date}
                                      onChange={(event) => updateEditField("passport_issued_date", event.target.value)}
                                    />
                                  </FormField>
                                  <FormField label="Ідентифікаційний код">
                                    <input className={formControlClass} value={editForm.tax_id} onChange={(event) => updateEditField("tax_id", event.target.value)} />
                                  </FormField>
                                  <FormField label="Телефон">
                                    <input className={formControlClass} value={editForm.phone} onChange={(event) => updateEditField("phone", event.target.value)} />
                                  </FormField>
                                  <FormField label="Статус">
                                    <select className={formControlClass} value={editForm.status} onChange={(event) => updateEditField("status", event.target.value)}>
                                      {TRAINEE_STATUS_OPTIONS.map((item) => (
                                        <option key={item.value} value={item.value}>
                                          {item.label}
                                        </option>
                                      ))}
                                    </select>
                                  </FormField>
                                  <div className="md:col-span-2 flex flex-wrap gap-2">
                                    <FormSubmitButton
                                      isLoading={isSavingEdit}
                                      idleLabel="Зберегти"
                                      loadingLabel="Збереження..."
                                      className="rounded-lg bg-pine px-4 py-2 font-semibold text-white"
                                    />
                                    <button
                                      type="button"
                                      className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700"
                                      onClick={cancelEdit}
                                    >
                                      Скасувати
                                    </button>
                                  </div>
                                </form>
                              )}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </Panel>

      <ConfirmDialog
        open={archiveDialogOpen}
        title="Архівувати вибраних слухачів?"
        description={archiveDialogDescription}
        confirmLabel={isBulkUpdating ? "Архівація..." : "Архівувати"}
        cancelLabel="Скасувати"
        onConfirm={runBulkDelete}
        onCancel={closeBulkArchiveDialog}
        confirmVariant="danger"
        confirmDisabled={isBulkUpdating}
      />
    </div>
  );
}
