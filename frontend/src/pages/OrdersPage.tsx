import { FormEvent, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { FormField, FormSubmitButton, formControlClass } from "../components/FormField";
import { Panel } from "../components/Panel";
import { StickyActionBar } from "../components/StickyActionBar";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import type { Order } from "../types/api";

const ORDER_TYPES = [
  { value: "internal", label: "Внутрішній" },
  { value: "enrollment", label: "Зарахування" },
  { value: "expulsion", label: "Відрахування" }
] as const;

const ORDER_STATUSES = [
  { value: "draft", label: "Чернетка" },
  { value: "approved", label: "Затверджено" },
  { value: "archived", label: "Архівовано" }
] as const;
const ORDER_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  ORDER_STATUSES.map((item) => [item.value, item.label])
);

export function OrdersPage() {
  const { request, user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [rows, setRows] = useState<Order[]>([]);
  const [orderNumber, setOrderNumber] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [orderType, setOrderType] = useState<(typeof ORDER_TYPES)[number]["value"]>("internal");
  const [status, setStatus] = useState("draft");
  const [createErrors, setCreateErrors] = useState<{ orderNumber?: string; orderDate?: string }>({});
  const [editId, setEditId] = useState<number | null>(null);
  const [editOrderNumber, setEditOrderNumber] = useState("");
  const [editOrderDate, setEditOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [editOrderType, setEditOrderType] = useState<(typeof ORDER_TYPES)[number]["value"]>("internal");
  const [editStatus, setEditStatus] = useState("draft");
  const [editErrors, setEditErrors] = useState<{ orderNumber?: string; orderDate?: string }>({});
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);

  const canEdit = useMemo(
    () => user?.roles.some((role) => role.name === "admin" || role.name === "methodist") ?? false,
    [user]
  );

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await request<Order[]>("/orders");
      setRows(data);
      setLoadError(null);
      if (editId) {
        const current = data.find((item) => item.id === editId);
        if (current) {
          beginEdit(current);
        } else {
          resetEdit();
        }
      }
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

  const createOrder = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit) return;
    const nextErrors: { orderNumber?: string; orderDate?: string } = {};
    if (!orderNumber.trim()) nextErrors.orderNumber = "Вкажіть номер наказу";
    if (!orderDate) nextErrors.orderDate = "Вкажіть дату наказу";
    if (Object.keys(nextErrors).length) {
      setCreateErrors(nextErrors);
      showError(Object.values(nextErrors)[0]);
      return;
    }
    setCreateErrors({});
    setIsCreating(true);
    try {
      await request<Order>("/orders", {
        method: "POST",
        body: JSON.stringify({
          order_number: orderNumber,
          order_type: orderType,
          order_date: orderDate,
          status,
          payload_json: { source: "manual_ui" }
        })
      });
      setOrderNumber("");
      setStatus("draft");
      setCreateErrors({});
      showSuccess("Наказ створено");
      await load();
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsCreating(false);
    }
  };

  const beginEdit = (row: Order) => {
    setEditId(row.id);
    setEditOrderNumber(row.order_number);
    setEditOrderDate(row.order_date.slice(0, 10));
    setEditOrderType(row.order_type);
    setEditStatus(row.status);
  };

  const resetEdit = () => {
    setEditId(null);
    setEditOrderNumber("");
    setEditOrderDate(new Date().toISOString().slice(0, 10));
    setEditOrderType("internal");
    setEditStatus("draft");
    setEditErrors({});
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || !editId) return;
    const nextErrors: { orderNumber?: string; orderDate?: string } = {};
    if (!editOrderNumber.trim()) nextErrors.orderNumber = "Вкажіть номер наказу";
    if (!editOrderDate) nextErrors.orderDate = "Вкажіть дату наказу";
    if (Object.keys(nextErrors).length) {
      setEditErrors(nextErrors);
      showError(Object.values(nextErrors)[0]);
      return;
    }
    setEditErrors({});
    setIsSavingEdit(true);
    try {
      await request<Order>(`/orders/${editId}`, {
        method: "PUT",
        body: JSON.stringify({
          order_number: editOrderNumber,
          order_type: editOrderType,
          order_date: editOrderDate,
          status: editStatus
        })
      });
      showSuccess(`Наказ ${editOrderNumber} оновлено`);
      await load();
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const deleteOrder = async (row: Order) => {
    if (!canEdit) return;
    setOrderToDelete(row);
  };

  const confirmDeleteOrder = async () => {
    if (!orderToDelete) return;
    try {
      await request<void>(`/orders/${orderToDelete.id}`, { method: "DELETE" });
      showSuccess(`Наказ "${orderToDelete.order_number}" видалено`);
      if (editId === orderToDelete.id) {
        resetEdit();
      }
      setOrderToDelete(null);
      await load();
    } catch (error) {
      showError((error as Error).message);
    }
  };

  const columns = useMemo<DataTableColumn<Order>[]>(() => {
    const baseColumns: DataTableColumn<Order>[] = [
      {
        key: "order_number",
        header: "№",
        render: (row) => <span className="font-semibold">{row.order_number}</span>,
        sortAccessor: (row) => row.order_number
      },
      {
        key: "order_type",
        header: "Тип",
        render: (row) => row.order_type,
        sortAccessor: (row) => row.order_type
      },
      {
        key: "order_date",
        header: "Дата",
        render: (row) => new Date(row.order_date).toLocaleDateString("uk-UA"),
        sortAccessor: (row) => row.order_date
      },
      {
        key: "status",
        header: "Статус",
        render: (row) => ORDER_STATUS_LABELS[row.status] || row.status,
        sortAccessor: (row) => row.status
      },
      {
        key: "created_at",
        header: "Створено",
        render: (row) => new Date(row.created_at).toLocaleString("uk-UA"),
        sortAccessor: (row) => row.created_at
      }
    ];

    if (!canEdit) {
      return baseColumns;
    }

    return [
      ...baseColumns,
      {
        key: "actions",
        header: "Дії",
        render: (row) => (
          <div className="flex gap-2">
            <button
              className="rounded-lg bg-pine px-3 py-1.5 text-xs font-semibold text-white"
              onClick={() => beginEdit(row)}
            >
              Редагувати
            </button>
            <button
              className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-700"
              onClick={() => deleteOrder(row)}
            >
              Видалити
            </button>
          </div>
        )
      }
    ];
  }, [canEdit, deleteOrder]);

  return (
    <div className="space-y-5">
      {canEdit && (
        <Panel title="Створити наказ">
          <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-5" onSubmit={createOrder}>
            <FormField
              label="Номер наказу"
              required
              helperText="Наприклад: 167-25"
              errorText={createErrors.orderNumber}
            >
              <input
                className={formControlClass}
                placeholder="167-25"
                value={orderNumber}
                onChange={(event) => {
                  setOrderNumber(event.target.value);
                  setCreateErrors((prev) => ({ ...prev, orderNumber: undefined }));
                }}
                required
              />
            </FormField>
            <FormField label="Тип наказу">
              <select
                className={formControlClass}
                value={orderType}
                onChange={(event) => setOrderType(event.target.value as (typeof ORDER_TYPES)[number]["value"])}
              >
                {ORDER_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Дата наказу" required errorText={createErrors.orderDate}>
              <input
                type="date"
                className={formControlClass}
                value={orderDate}
                onChange={(event) => {
                  setOrderDate(event.target.value);
                  setCreateErrors((prev) => ({ ...prev, orderDate: undefined }));
                }}
                required
              />
            </FormField>
            <FormField
              label="Статус"
              helperText="Поточний стан наказу"
            >
              <select
                className={formControlClass}
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                {ORDER_STATUSES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="flex items-end">
              <FormSubmitButton
                isLoading={isCreating}
                idleLabel="Створити"
                loadingLabel="Створюємо..."
                className="w-full rounded-lg bg-pine px-4 py-2 font-semibold text-white"
              />
            </div>
          </form>
        </Panel>
      )}
      {canEdit && editId && (
        <Panel title={`Редагувати наказ #${editId}`}>
          <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-5" onSubmit={saveEdit}>
            <FormField label="Номер наказу" required errorText={editErrors.orderNumber}>
              <input
                className={formControlClass}
                placeholder="Номер наказу"
                value={editOrderNumber}
                onChange={(event) => {
                  setEditOrderNumber(event.target.value);
                  setEditErrors((prev) => ({ ...prev, orderNumber: undefined }));
                }}
                required
              />
            </FormField>
            <FormField label="Тип наказу">
              <select
                className={formControlClass}
                value={editOrderType}
                onChange={(event) => setEditOrderType(event.target.value as (typeof ORDER_TYPES)[number]["value"])}
              >
                {ORDER_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Дата наказу" required errorText={editErrors.orderDate}>
              <input
                type="date"
                className={formControlClass}
                value={editOrderDate}
                onChange={(event) => {
                  setEditOrderDate(event.target.value);
                  setEditErrors((prev) => ({ ...prev, orderDate: undefined }));
                }}
                required
              />
            </FormField>
            <FormField label="Статус" helperText="Поточний стан наказу">
              <select
                className={formControlClass}
                value={editStatus}
                onChange={(event) => setEditStatus(event.target.value)}
              >
                {ORDER_STATUSES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="flex gap-2">
              <FormSubmitButton
                isLoading={isSavingEdit}
                idleLabel="Зберегти"
                loadingLabel="Зберігаємо..."
                className="rounded-lg bg-pine px-4 py-2 font-semibold text-white"
              />
              <button
                type="button"
                className="rounded-lg bg-slate-200 px-4 py-2 font-semibold text-slate-700"
                onClick={resetEdit}
              >
                Скасувати
              </button>
            </div>
          </form>
        </Panel>
      )}
      <Panel title="Реєстр наказів">
        <StickyActionBar className="mb-3">
          <button className="rounded-lg bg-amber px-4 py-2 font-semibold text-ink" onClick={load}>
            Оновити
          </button>
        </StickyActionBar>
        <DataTable
          data={rows}
          columns={columns}
          rowKey={(row) => row.id}
          isLoading={isLoading}
          errorText={loadError}
          onRetry={load}
          emptyText="Накази відсутні"
          search={{
            placeholder: "Пошук за номером, типом або статусом",
            getSearchText: (row) => `${row.order_number} ${row.order_type} ${row.status}`
          }}
        />
      </Panel>
      <ConfirmDialog
        open={Boolean(orderToDelete)}
        title="Підтвердження видалення наказу"
        description={
          orderToDelete
            ? `Ви дійсно хочете видалити наказ "${orderToDelete.order_number}"? Дію неможливо скасувати.`
            : ""
        }
        confirmLabel="Видалити"
        onCancel={() => setOrderToDelete(null)}
        onConfirm={confirmDeleteOrder}
      />
    </div>
  );
}
