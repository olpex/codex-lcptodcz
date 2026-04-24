import { FormEvent, useEffect, useMemo, useState } from "react";
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

  const canEdit = useMemo(
    () => user?.roles.some((role) => role.name === "admin" || role.name === "methodist") ?? false,
    [user]
  );

  const load = async () => {
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
    }
  };

  useEffect(() => {
    load();
  }, []);

  const createOrder = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit) return;
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
    }
  };

  const deleteOrder = async (orderId: number) => {
    if (!canEdit) return;
    try {
      await request<void>(`/orders/${orderId}`, { method: "DELETE" });
      showSuccess(`Наказ #${orderId} видалено`);
      if (editId === orderId) {
        resetEdit();
      }
      await load();
    } catch (error) {
      showError((error as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      {canEdit && (
        <Panel title="Створити наказ">
          <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-5" onSubmit={createOrder}>
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Номер наказу"
              value={orderNumber}
              onChange={(event) => setOrderNumber(event.target.value)}
              required
            />
            <select
              className="rounded-lg border border-slate-300 px-3 py-2"
              value={orderType}
              onChange={(event) => setOrderType(event.target.value as (typeof ORDER_TYPES)[number]["value"])}
            >
              {ORDER_TYPES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <input
              type="date"
              className="rounded-lg border border-slate-300 px-3 py-2"
              value={orderDate}
              onChange={(event) => setOrderDate(event.target.value)}
              required
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Статус"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              required
            />
            <button className="rounded-lg bg-pine px-4 py-2 font-semibold text-white">Створити</button>
          </form>
        </Panel>
      )}
      {canEdit && editId && (
        <Panel title={`Редагувати наказ #${editId}`}>
          <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-5" onSubmit={saveEdit}>
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Номер наказу"
              value={editOrderNumber}
              onChange={(event) => setEditOrderNumber(event.target.value)}
              required
            />
            <select
              className="rounded-lg border border-slate-300 px-3 py-2"
              value={editOrderType}
              onChange={(event) => setEditOrderType(event.target.value as (typeof ORDER_TYPES)[number]["value"])}
            >
              {ORDER_TYPES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <input
              type="date"
              className="rounded-lg border border-slate-300 px-3 py-2"
              value={editOrderDate}
              onChange={(event) => setEditOrderDate(event.target.value)}
              required
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Статус"
              value={editStatus}
              onChange={(event) => setEditStatus(event.target.value)}
              required
            />
            <div className="flex gap-2">
              <button className="rounded-lg bg-pine px-4 py-2 font-semibold text-white">Зберегти</button>
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
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-600">
                <th className="px-2 py-2">№</th>
                <th className="px-2 py-2">Тип</th>
                <th className="px-2 py-2">Дата</th>
                <th className="px-2 py-2">Статус</th>
                <th className="px-2 py-2">Створено</th>
                {canEdit && <th className="px-2 py-2">Дії</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100">
                  <td className="px-2 py-2 font-semibold">{row.order_number}</td>
                  <td className="px-2 py-2">{row.order_type}</td>
                  <td className="px-2 py-2">{new Date(row.order_date).toLocaleDateString("uk-UA")}</td>
                  <td className="px-2 py-2">{row.status}</td>
                  <td className="px-2 py-2">{new Date(row.created_at).toLocaleString("uk-UA")}</td>
                  {canEdit && (
                    <td className="px-2 py-2">
                      <div className="flex gap-2">
                        <button
                          className="rounded-lg bg-pine px-3 py-1.5 text-xs font-semibold text-white"
                          onClick={() => beginEdit(row)}
                        >
                          Редагувати
                        </button>
                        <button
                          className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-700"
                          onClick={() => deleteOrder(row.id)}
                        >
                          Видалити
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
