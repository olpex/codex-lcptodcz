import { FormEvent, useEffect, useMemo, useState } from "react";
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
  const canEdit = useMemo(
    () => user?.roles.some((role) => role.name === "admin" || role.name === "methodist") ?? false,
    [user]
  );

  const loadGroups = async () => {
    try {
      const data = await request<Group[]>("/groups");
      setGroups(data);
    } catch (error) {
      showError((error as Error).message);
    }
  };

  useEffect(() => {
    loadGroups();
  }, []);

  const createGroup = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit) return;
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
    }
  };

  return (
    <div className="space-y-5">
      {canEdit && (
        <Panel title="Створити групу">
          <form className="grid gap-3 md:grid-cols-4" onSubmit={createGroup}>
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Код групи"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Назва групи"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
            <input
              type="number"
              className="rounded-lg border border-slate-300 px-3 py-2"
              value={capacity}
              min={1}
              max={200}
              onChange={(event) => setCapacity(Number(event.target.value))}
            />
            <button className="rounded-lg bg-pine px-4 py-2 font-semibold text-white">Створити</button>
          </form>
        </Panel>
      )}
      <Panel title="Реєстр груп">
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-600">
                <th className="px-2 py-2">Код</th>
                <th className="px-2 py-2">Назва</th>
                <th className="px-2 py-2">Статус</th>
                <th className="px-2 py-2">Місткість</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id} className="border-b border-slate-100">
                  <td className="px-2 py-2 font-semibold">{group.code}</td>
                  <td className="px-2 py-2">{group.name}</td>
                  <td className="px-2 py-2">{group.status}</td>
                  <td className="px-2 py-2">{group.capacity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
