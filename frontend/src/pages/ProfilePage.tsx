import { FormEvent, useState } from "react";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";

type MessageResponse = {
  message: string;
};

export function ProfilePage() {
  const { request, logout, user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setNotice("");

    if (newPassword.length < 8) {
      setError("Новий пароль має містити щонайменше 8 символів");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Підтвердження пароля не співпадає");
      return;
    }

    setSubmitting(true);
    try {
      const response = await request<MessageResponse>("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword
        })
      });
      setNotice(response.message || "Пароль змінено");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => {
        logout();
      }, 1200);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <Panel title="Профіль користувача">
        <div className="grid gap-2 text-sm text-slate-700">
          <p>
            Логін: <span className="font-semibold">{user?.username}</span>
          </p>
          <p>
            Ім'я: <span className="font-semibold">{user?.full_name}</span>
          </p>
        </div>
      </Panel>

      <Panel title="Змінити пароль">
        <form className="space-y-3" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Поточний пароль</span>
            <input
              type="password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Новий пароль</span>
            <input
              type="password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Підтвердження нового пароля</span>
            <input
              type="password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>

          {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          {notice && <p className="rounded-lg bg-skyline p-2 text-sm text-pine">{notice}</p>}

          <button
            disabled={submitting}
            className="rounded-lg bg-pine px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            {submitting ? "Зберігаємо..." : "Змінити пароль"}
          </button>
          <p className="text-xs text-slate-500">Після зміни пароля ви будете автоматично розлогінені.</p>
        </form>
      </Panel>
    </div>
  );
}

