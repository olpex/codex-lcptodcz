import { FormEvent, useEffect, useMemo, useState } from "react";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { FormField, FormSubmitButton, formControlClass } from "../components/FormField";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import type { Trainee } from "../types/api";

export function TraineesPage() {
  const { request, user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canEdit = useMemo(
    () => user?.roles.some((role) => role.name === "admin" || role.name === "methodist") ?? false,
    [user]
  );

  const columns = useMemo<DataTableColumn<Trainee>[]>(
    () => [
      {
        key: "full_name",
        header: "ПІБ",
        render: (trainee) => (
          <span className="font-semibold">
            {trainee.last_name} {trainee.first_name}
          </span>
        ),
        sortAccessor: (trainee) => `${trainee.last_name} ${trainee.first_name}`
      },
      {
        key: "status",
        header: "Статус",
        render: (trainee) => trainee.status,
        sortAccessor: (trainee) => trainee.status
      },
      {
        key: "phone",
        header: "Телефон",
        render: (trainee) => trainee.phone || "—",
        sortAccessor: (trainee) => trainee.phone || ""
      },
      {
        key: "email",
        header: "Email",
        render: (trainee) => trainee.email || "—",
        sortAccessor: (trainee) => trainee.email || ""
      }
    ],
    []
  );

  const fetchTrainees = async (term = "") => {
    setIsLoading(true);
    try {
      const query = term ? `?search=${encodeURIComponent(term)}` : "";
      const data = await request<Trainee[]>(`/trainees${query}`);
      setTrainees(data);
    } catch (error) {
      showError((error as Error).message);
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
    setIsSubmitting(true);
    try {
      await request("/trainees", {
        method: "POST",
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          email: email || null,
          phone: phone || null,
          status: "active"
        })
      });
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      await fetchTrainees(search);
      showSuccess("Слухача додано");
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <Panel title="Пошук слухачів">
        <div className="flex flex-wrap gap-3">
          <FormField
            className="min-w-[240px] flex-1"
            label="Пошуковий запит"
            helperText="Введіть ім'я, прізвище або частину ПІБ"
          >
            <input
              className={formControlClass}
              placeholder="Наприклад: Петренко"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </FormField>
          <button className="rounded-lg bg-pine px-4 py-2 font-semibold text-white" onClick={() => fetchTrainees(search)}>
            Знайти
          </button>
        </div>
      </Panel>
      {canEdit && (
        <Panel title="Додати слухача">
          <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={createTrainee}>
            <FormField label="Ім'я" required>
              <input
                className={formControlClass}
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                placeholder="Ім'я"
                required
              />
            </FormField>
            <FormField label="Прізвище" required>
              <input
                className={formControlClass}
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                placeholder="Прізвище"
                required
              />
            </FormField>
            <FormField label="Email" helperText="Необов'язково">
              <input
                className={formControlClass}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="teacher@example.com"
              />
            </FormField>
            <div className="flex gap-2">
              <FormField className="flex-1" label="Телефон" helperText="Необов'язково">
                <input
                  className={formControlClass}
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+380..."
                />
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
        <DataTable
          data={trainees}
          columns={columns}
          rowKey={(trainee) => trainee.id}
          isLoading={isLoading}
          emptyText="Слухачі відсутні"
        />
      </Panel>
    </div>
  );
}
