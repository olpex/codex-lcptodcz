import { FormEvent, useState } from "react";
import { Link, Navigate } from "react-router-dom";
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
          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Логін</span>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          <label className="mb-5 block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Пароль</span>
            <input
              type="password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button
            disabled={submitting}
            className="w-full rounded-lg bg-pine px-4 py-2.5 font-semibold text-white disabled:opacity-50"
          >
            {submitting ? "Виконується..." : uiText.actions.login}
          </button>
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
