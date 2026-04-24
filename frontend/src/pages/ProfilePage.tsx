import { FormEvent, useState } from "react";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

type MessageResponse = {
  message: string;
};

export function ProfilePage() {
  const { request, logout, user } = useAuth();
  const { showError, showInfo, showSuccess } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (newPassword.length < 8) {
      showError("Новий пароль має містити щонайменше 8 символів");
      return;
    }
    if (newPassword.length > 72) {
      showError("Новий пароль має містити не більше 72 символів");
      return;
    }
    if (newPassword !== confirmPassword) {
      showError("Підтвердження пароля не співпадає");
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
      showSuccess(response.message || "Пароль змінено");
      showInfo("Виконуємо повторний вхід з новим паролем...");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => {
        logout();
      }, 1200);
    } catch (error) {
      showError((error as Error).message);
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
              maxLength={72}
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
              maxLength={72}
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
              maxLength={72}
              required
            />
          </label>

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
