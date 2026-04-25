import { FormEvent, useEffect, useMemo, useState } from "react";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { FormField, FormSubmitButton, formControlClass } from "../components/FormField";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import type { Group } from "../types/api";

export function GroupsPage() {
  const { request, user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [capacity, setCapacity] = useState(25);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; code?: string; capacity?: string }>({});
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
        render: (group) => group.status,
        sortAccessor: (group) => group.status
      },
      {
        key: "capacity",
        header: "Місткість",
        render: (group) => group.capacity,
        sortAccessor: (group) => group.capacity
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
      <Panel title="Реєстр груп">
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
            getSearchText: (group) => `${group.code} ${group.name} ${group.status}`
          }}
        />
      </Panel>
    </div>
  );
}
