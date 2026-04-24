import { FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { uiText } from "../i18n/uk";

type MessageResponse = {
  message: string;
};

export function AdminResetPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();

  const [username, setUsername] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    return <Navigate to="/" replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!username.trim()) {
      showError("Вкажіть логін користувача");
      return;
    }
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
      const response = await apiRequest<MessageResponse>("/auth/admin-reset-password", {
        method: "POST",
        body: JSON.stringify({
          username: username.trim(),
          reset_token: resetToken,
          new_password: newPassword
        })
      });
      showSuccess(response.message || "Пароль адміністратора успішно скинуто");
      navigate("/login", { replace: true });
    } catch (error) {
      showError((error as Error).message || "Не вдалося скинути пароль");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_right,#d8ecf2_0%,#f2f7f5_50%,#ffffff_100%)] px-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-card">
        <h1 className="font-heading text-3xl font-bold text-pine">{uiText.appTitle}</h1>
        <p className="mb-2 mt-2 text-sm text-slate-600">{uiText.appSubtitle}</p>
        <p className="mb-6 rounded-lg bg-mist px-3 py-2 text-xs text-slate-600">
          Аварійне скидання пароля. Використайте службовий токен з `ADMIN_PASSWORD_RESET_TOKEN`.
        </p>

        <form className="space-y-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Логін</span>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Службовий токен</span>
            <input
              type="password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              value={resetToken}
              onChange={(event) => setResetToken(event.target.value)}
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
            className="w-full rounded-lg border border-pine bg-white px-4 py-2.5 font-semibold text-pine disabled:opacity-50"
          >
            {submitting ? "Скидаємо..." : "Скинути пароль адміністратора"}
          </button>
        </form>

        <Link className="mt-4 inline-block text-sm font-semibold text-pine hover:underline" to="/login">
          Повернутися до входу
        </Link>
      </div>
    </div>
  );
}
