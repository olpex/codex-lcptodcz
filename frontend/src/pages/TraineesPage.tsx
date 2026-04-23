import { FormEvent, useEffect, useMemo, useState } from "react";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import type { Trainee } from "../types/api";

export function TraineesPage() {
  const { request, user } = useAuth();
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const canEdit = useMemo(
    () => user?.roles.some((role) => role.name === "admin" || role.name === "methodist") ?? false,
    [user]
  );

  const fetchTrainees = async (term = "") => {
    setError("");
    try {
      const query = term ? `?search=${encodeURIComponent(term)}` : "";
      const data = await request<Trainee[]>(`/trainees${query}`);
      setTrainees(data);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    fetchTrainees();
  }, []);

  const createTrainee = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit) return;
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
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <Panel title="Пошук слухачів">
        <div className="flex flex-wrap gap-3">
          <input
            className="min-w-[240px] flex-1 rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Пошук за ім'ям або прізвищем"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button className="rounded-lg bg-pine px-4 py-2 font-semibold text-white" onClick={() => fetchTrainees(search)}>
            Знайти
          </button>
        </div>
      </Panel>
      {canEdit && (
        <Panel title="Додати слухача">
          <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={createTrainee}>
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              placeholder="Ім'я"
              required
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              placeholder="Прізвище"
              required
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email"
            />
            <div className="flex gap-2">
              <input
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="Телефон"
              />
              <button className="rounded-lg bg-pine px-4 py-2 font-semibold text-white">Додати</button>
            </div>
          </form>
        </Panel>
      )}
      <Panel title="Реєстр слухачів">
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-600">
                <th className="px-2 py-2">ПІБ</th>
                <th className="px-2 py-2">Статус</th>
                <th className="px-2 py-2">Телефон</th>
                <th className="px-2 py-2">Email</th>
              </tr>
            </thead>
            <tbody>
              {trainees.map((trainee) => (
                <tr key={trainee.id} className="border-b border-slate-100">
                  <td className="px-2 py-2 font-semibold">
                    {trainee.last_name} {trainee.first_name}
                  </td>
                  <td className="px-2 py-2">{trainee.status}</td>
                  <td className="px-2 py-2">{trainee.phone || "—"}</td>
                  <td className="px-2 py-2">{trainee.email || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

