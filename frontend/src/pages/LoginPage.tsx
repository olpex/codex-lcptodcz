import { FormEvent, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { FormField, FormSubmitButton, formControlClass } from "../components/FormField";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { uiText } from "../i18n/uk";

export function LoginPage() {
  const { login, user } = useAuth();
  const { showError } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    return <Navigate to="/" replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim()) {
      showError("Вкажіть логін");
      return;
    }
    if (!password) {
      showError("Вкажіть пароль");
      return;
    }

    setSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (error) {
      const err = error as Error;
      showError(err.message || "Не вдалося увійти");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_right,#d8ecf2_0%,#f2f7f5_50%,#ffffff_100%)] px-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-card">
        <h1 className="font-heading text-3xl font-bold text-pine">{uiText.appTitle}</h1>
        <p className="mb-6 mt-2 text-sm text-slate-600">{uiText.appSubtitle}</p>

        <form onSubmit={onSubmit}>
          <FormField className="mb-4" label="Логін" required helperText="Ваш обліковий запис у системі">
            <input
              className={formControlClass}
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </FormField>
          <FormField className="mb-5" label="Пароль" required helperText="Має містити від 8 до 72 символів">
            <input
              type="password"
              className={formControlClass}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </FormField>
          <FormSubmitButton
            isLoading={submitting}
            idleLabel={uiText.actions.login}
            loadingLabel="Виконується..."
            className="w-full rounded-lg bg-pine px-4 py-2.5 font-semibold text-white"
          />
        </form>

        <div className="mt-6 border-t border-slate-200 pt-4">
          <p className="text-sm text-slate-600">Не знаєте поточний пароль?</p>
          <Link className="mt-2 inline-block text-sm font-semibold text-pine hover:underline" to="/login/admin-reset">
            Аварійне відновлення доступу
          </Link>
        </div>
      </div>
    </div>
  );
}
