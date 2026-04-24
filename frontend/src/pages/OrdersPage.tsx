import { FormEvent, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { FormField, FormSubmitButton, formControlClass } from "../components/FormField";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import type { Order } from "../types/api";

const ORDER_TYPES = [
  { value: "internal", label: "Внутрішній" },
  { value: "enrollment", label: "Зарахування" },
  { value: "expulsion", label: "Відрахування" }
] as const;

export function OrdersPage() {
  const { request, user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [rows, setRows] = useState<Order[]>([]);
  const [orderNumber, setOrderNumber] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [orderType, setOrderType] = useState<(typeof ORDER_TYPES)[number]["value"]>("internal");
  const [status, setStatus] = useState("draft");
  const [editId, setEditId] = useState<number | null>(null);
  const [editOrderNumber, setEditOrderNumber] = useState("");
  const [editOrderDate, setEditOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [editOrderType, setEditOrderType] = useState<(typeof ORDER_TYPES)[number]["value"]>("internal");
  const [editStatus, setEditStatus] = useState("draft");
  const [isLoading, setIsLoading] = useState(false);
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
      if (editId) {
        const current = data.find((item) => item.id === editId);
        if (current) {
          beginEdit(current);
        } else {
          resetEdit();
        }
      }
    } catch (error) {
      showError((error as Error).message);
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
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || !editId) return;
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
        render: (row) => row.status,
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
            <FormField label="Номер наказу" required helperText="Наприклад: 167-25">
              <input
                className={formControlClass}
                placeholder="167-25"
                value={orderNumber}
                onChange={(event) => setOrderNumber(event.target.value)}
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
            <FormField label="Дата наказу" required>
              <input
                type="date"
                className={formControlClass}
                value={orderDate}
                onChange={(event) => setOrderDate(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Статус" required helperText="draft, approved, archived тощо">
              <input
                className={formControlClass}
                placeholder="draft"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                required
              />
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
            <FormField label="Номер наказу" required>
              <input
                className={formControlClass}
                placeholder="Номер наказу"
                value={editOrderNumber}
                onChange={(event) => setEditOrderNumber(event.target.value)}
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
            <FormField label="Дата наказу" required>
              <input
                type="date"
                className={formControlClass}
                value={editOrderDate}
                onChange={(event) => setEditOrderDate(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Статус" required>
              <input
                className={formControlClass}
                placeholder="Статус"
                value={editStatus}
                onChange={(event) => setEditStatus(event.target.value)}
                required
              />
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
        <button className="mb-3 rounded-lg bg-amber px-4 py-2 font-semibold text-ink" onClick={load}>
          Оновити
        </button>
        <DataTable
          data={rows}
          columns={columns}
          rowKey={(row) => row.id}
          isLoading={isLoading}
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
