import { useEffect, useState } from "react";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import type { Draft, MailMessage } from "../types/api";

export function DraftsPage() {
  const { request } = useAuth();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    setError("");
    try {
      const [draftRows, mailRows] = await Promise.all([
        request<Draft[]>("/drafts"),
        request<MailMessage[]>("/mail/messages")
      ]);
      setDrafts(draftRows);
      setMessages(mailRows);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const pollNow = async () => {
    try {
      await request("/mail/poll-now", { method: "POST" });
      setNotice("Опитування поштової скриньки запущено");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const approveDraft = async (draftId: number) => {
    try {
      await request(`/drafts/${draftId}/approve`, { method: "POST" });
      setNotice(`Чернетка ${draftId} підтверджена`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {notice && <p className="rounded-lg bg-skyline p-2 text-sm text-pine">{notice}</p>}
      <Panel title="Вхідна кореспонденція">
        <div className="mb-3 flex items-center gap-3">
          <button className="rounded-lg bg-pine px-4 py-2 font-semibold text-white" onClick={pollNow}>
            Опитати пошту зараз
          </button>
          <button className="rounded-lg bg-amber px-4 py-2 font-semibold text-ink" onClick={load}>
            Оновити
          </button>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-600">
                <th className="px-2 py-2">Дата</th>
                <th className="px-2 py-2">Відправник</th>
                <th className="px-2 py-2">Тема</th>
                <th className="px-2 py-2">Статус</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((message) => (
                <tr key={message.id} className="border-b border-slate-100">
                  <td className="px-2 py-2">{new Date(message.received_at).toLocaleString("uk-UA")}</td>
                  <td className="px-2 py-2">{message.sender}</td>
                  <td className="px-2 py-2">{message.subject}</td>
                  <td className="px-2 py-2">{message.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Чернетки OCR">
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-600">
                <th className="px-2 py-2">ID</th>
                <th className="px-2 py-2">Тип</th>
                <th className="px-2 py-2">Довіра</th>
                <th className="px-2 py-2">Статус</th>
                <th className="px-2 py-2">Дія</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((draft) => (
                <tr key={draft.id} className="border-b border-slate-100">
                  <td className="px-2 py-2">{draft.id}</td>
                  <td className="px-2 py-2">{draft.draft_type}</td>
                  <td className="px-2 py-2">{(draft.confidence * 100).toFixed(0)}%</td>
                  <td className="px-2 py-2">{draft.status}</td>
                  <td className="px-2 py-2">
                    <button
                      disabled={draft.status === "approved"}
                      className="rounded-lg bg-pine px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                      onClick={() => approveDraft(draft.id)}
                    >
                      Підтвердити
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

