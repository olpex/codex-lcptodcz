import { FormEvent, useEffect, useMemo, useState } from "react";
import { FormField, FormSubmitButton, formControlClass } from "../components/FormField";
import { InlineNotice } from "../components/InlineNotice";
import { Panel } from "../components/Panel";
import { StickyActionBar } from "../components/StickyActionBar";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import type { Trainee } from "../types/api";

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
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [groupCode, setGroupCode] = useState("");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [bulkGroupCode, setBulkGroupCode] = useState("");
  const [bulkStatus, setBulkStatus] = useState<"active" | "completed" | "expelled">("active");
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState<TraineeEditForm | null>(null);

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

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, checked]) => checked).map(([id]) => Number(id)),
    [selected]
  );

  const fetchTrainees = async (term = "") => {
    setIsLoading(true);
    try {
      const query = term ? `?search=${encodeURIComponent(term)}` : "";
      const data = await request<Trainee[]>(`/trainees${query}`);
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
    fetchTrainees();
  }, []);

  const createTrainee = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit) return;
    if (!firstName.trim() || !lastName.trim()) {
      showError("Вкажіть ім'я та прізвище");
      return;
    }
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

  const expandAll = () => {
    const next: Record<number, boolean> = {};
    for (const trainee of sortedTrainees) next[trainee.id] = true;
    setExpanded(next);
  };

  const collapseAll = () => setExpanded({});

  const toggleSelected = (id: number) => {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectAllVisible = () => {
    const next: Record<number, boolean> = {};
    for (const trainee of sortedTrainees) next[trainee.id] = true;
    setSelected(next);
  };

  const clearSelection = () => setSelected({});

  const runBulkGroupUpdate = async (targetGroupCode: string | null) => {
    if (!selectedIds.length) {
      showError("Виберіть щонайменше одного слухача");
      return;
    }
    setIsBulkUpdating(true);
    try {
      const payload = {
        trainee_ids: selectedIds,
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
    if (!selectedIds.length) {
      showError("Виберіть щонайменше одного слухача");
      return;
    }
    setIsBulkUpdating(true);
    try {
      const payload = {
        trainee_ids: selectedIds,
        status: targetStatus
      };
      const response = await request<BulkStatusUpdateResponse>("/trainees/bulk/status", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      await fetchTrainees(search);
      clearSelection();
      showSuccess(`Оновлено статус (${response.status}) для ${response.updated_count} слухачів`);
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const startEdit = (trainee: Trainee) => {
    setEditingId(trainee.id);
    setEditForm(toEditForm(trainee));
    setExpanded((prev) => ({ ...prev, [trainee.id]: true }));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(null);
  };

  const updateEditField = (field: keyof TraineeEditForm, value: string) => {
    setEditForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || !editingId || !editForm) return;
    if (!editForm.first_name.trim() || !editForm.last_name.trim()) {
      showError("Ім'я та прізвище є обов'язковими");
      return;
    }
    setIsSavingEdit(true);
    try {
      const payload = {
        first_name: editForm.first_name.trim(),
        last_name: editForm.last_name.trim(),
        source_row_number: editForm.source_row_number ? Number(editForm.source_row_number) : null,
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
          </div>
        </StickyActionBar>
      </Panel>

      {canEdit && (
        <Panel title="Додати слухача вручну">
          <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={createTrainee}>
            <FormField label="Ім'я" required>
              <input className={formControlClass} value={firstName} onChange={(event) => setFirstName(event.target.value)} required />
            </FormField>
            <FormField label="Прізвище" required>
              <input className={formControlClass} value={lastName} onChange={(event) => setLastName(event.target.value)} required />
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
                  disabled={isBulkUpdating || !selectedIds.length}
                >
                  Призначити групу
                </button>
                <button
                  className="rounded-lg bg-amber px-3 py-2 text-sm font-semibold text-ink disabled:opacity-50"
                  onClick={() => runBulkGroupUpdate(null)}
                  disabled={isBulkUpdating || !selectedIds.length}
                >
                  Очистити групу
                </button>
                <select
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={bulkStatus}
                  onChange={(event) => setBulkStatus(event.target.value as "active" | "completed" | "expelled")}
                >
                  <option value="active">active</option>
                  <option value="completed">completed</option>
                  <option value="expelled">expelled</option>
                </select>
                <button
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  onClick={() => runBulkStatusUpdate(bulkStatus)}
                  disabled={isBulkUpdating || !selectedIds.length}
                >
                  Змінити статус
                </button>
              </>
            )}
          </div>
        </StickyActionBar>
        {isLoading && <p className="text-sm text-slate-600">Завантаження...</p>}
        {!isLoading && sortedTrainees.length === 0 && <p className="text-sm text-slate-600">Слухачі відсутні</p>}
        <div className="space-y-2">
          {sortedTrainees.map((trainee, index) => {
            const isExpanded = Boolean(expanded[trainee.id]);
            const isEditing = editingId === trainee.id;
            const number = trainee.source_row_number ?? index + 1;
            const isSelected = Boolean(selected[trainee.id]);
            return (
              <article key={trainee.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
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
                      </div>
                    )}

                    {canEdit && !isEditing && (
                      <div>
                        <button
                          type="button"
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                          onClick={() => startEdit(trainee)}
                        >
                          Редагувати
                        </button>
                      </div>
                    )}

                    {canEdit && isEditing && editForm && (
                      <form className="grid gap-3 md:grid-cols-2" onSubmit={saveEdit}>
                        <FormField label="Номер">
                          <input
                            className={formControlClass}
                            value={editForm.source_row_number}
                            onChange={(event) => updateEditField("source_row_number", event.target.value)}
                          />
                        </FormField>
                        <FormField label="Номер групи">
                          <input className={formControlClass} value={editForm.group_code} onChange={(event) => updateEditField("group_code", event.target.value)} />
                        </FormField>
                        <FormField label="Прізвище" required>
                          <input className={formControlClass} value={editForm.last_name} onChange={(event) => updateEditField("last_name", event.target.value)} required />
                        </FormField>
                        <FormField label="Ім'я та по батькові" required>
                          <input className={formControlClass} value={editForm.first_name} onChange={(event) => updateEditField("first_name", event.target.value)} required />
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
                            <option value="active">active</option>
                            <option value="completed">completed</option>
                            <option value="expelled">expelled</option>
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
      </Panel>
    </div>
  );
}
