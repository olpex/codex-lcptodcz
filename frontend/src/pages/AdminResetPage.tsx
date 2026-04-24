import { FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { FormField, FormSubmitButton, formControlClass } from "../components/FormField";
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
          <FormField label="Логін" required helperText="Логін облікового запису адміністратора">
            <input
              className={formControlClass}
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </FormField>

          <FormField label="Службовий токен" required helperText="Змінна середовища ADMIN_PASSWORD_RESET_TOKEN">
            <input
              type="password"
              className={formControlClass}
              value={resetToken}
              onChange={(event) => setResetToken(event.target.value)}
              required
            />
          </FormField>

          <FormField label="Новий пароль" required helperText="Мінімум 8 символів, максимум 72">
            <input
              type="password"
              className={formControlClass}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={8}
              maxLength={72}
              required
            />
          </FormField>

          <FormField label="Підтвердження нового пароля" required helperText="Повторіть новий пароль без помилок">
            <input
              type="password"
              className={formControlClass}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={8}
              maxLength={72}
              required
            />
          </FormField>

          <FormSubmitButton
            isLoading={submitting}
            idleLabel="Скинути пароль адміністратора"
            loadingLabel="Скидаємо..."
            className="w-full rounded-lg border border-pine bg-white px-4 py-2.5 font-semibold text-pine"
          />
        </form>

        <Link className="mt-4 inline-block text-sm font-semibold text-pine hover:underline" to="/login">
          Повернутися до входу
        </Link>
      </div>
    </div>
  );
}
