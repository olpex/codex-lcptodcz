import { FormEvent, useEffect, useMemo, useState } from "react";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import type { Order } from "../types/api";

const ORDER_TYPES = [
  { value: "internal", label: "Внутрішній" },
  { value: "enrollment", label: "Зарахування" },
  { value: "expulsion", label: "Відрахування" }
] as const;

export function OrdersPage() {
  const { request, user } = useAuth();
  const [rows, setRows] = useState<Order[]>([]);
  const [orderNumber, setOrderNumber] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [orderType, setOrderType] = useState<(typeof ORDER_TYPES)[number]["value"]>("internal");
  const [status, setStatus] = useState("draft");
  const [error, setError] = useState("");

  const canEdit = useMemo(
    () => user?.roles.some((role) => role.name === "admin" || role.name === "methodist") ?? false,
    [user]
  );

  const load = async () => {
    setError("");
    try {
      const data = await request<Order[]>("/orders");
      setRows(data);
    } catch (e) {
      setError((e as Error).message);
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
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

