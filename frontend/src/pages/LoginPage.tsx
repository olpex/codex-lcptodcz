import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { uiText } from "../i18n/uk";

type MessageResponse = {
  message: string;
};

export function LoginPage() {
  const { login, user } = useAuth();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("Admin123!");
  const [error, setError] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetNotice, setResetNotice] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);

  if (user) {
    return <Navigate to="/" replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(username, password);
    } catch (e) {
      const err = e as Error;
      setError(err.message || "Не вдалося увійти");
    } finally {
      setSubmitting(false);
    }
  };

  const onResetSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setResetError("");
    setResetNotice("");

    if (resetNewPassword.length < 8) {
      setResetError("Новий пароль має містити щонайменше 8 символів");
      return;
    }
    if (resetNewPassword.length > 72) {
      setResetError("Новий пароль має містити не більше 72 символів");
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setResetError("Підтвердження пароля не співпадає");
      return;
    }

    setResetSubmitting(true);
    try {
      const response = await apiRequest<MessageResponse>("/auth/admin-reset-password", {
        method: "POST",
        body: JSON.stringify({
          username,
          reset_token: resetToken,
          new_password: resetNewPassword
        })
      });
      setResetNotice(response.message || "Пароль скинуто");
      setPassword(resetNewPassword);
      setResetToken("");
      setResetNewPassword("");
      setResetConfirmPassword("");
    } catch (e) {
      const err = e as Error;
      setResetError(err.message || "Не вдалося скинути пароль");
    } finally {
      setResetSubmitting(false);
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
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="mb-5 block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Пароль</span>
            <input
              type="password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && <p className="mb-4 rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          <button
            disabled={submitting}
            className="w-full rounded-lg bg-pine px-4 py-2.5 font-semibold text-white disabled:opacity-50"
          >
            {submitting ? "Виконується..." : uiText.actions.login}
          </button>
        </form>

        <form onSubmit={onResetSubmit} className="mt-6 border-t border-slate-200 pt-4">
          <p className="mb-2 text-sm font-semibold text-slate-700">Не знаєте поточний пароль?</p>
          <p className="mb-3 text-xs text-slate-500">
            Екстрене скидання для адміністратора: введіть службовий токен із `ADMIN_PASSWORD_RESET_TOKEN`.
          </p>

          <div className="space-y-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-700">Службовий токен</span>
              <input
                type="password"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={resetToken}
                onChange={(event) => setResetToken(event.target.value)}
                minLength={1}
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-700">Новий пароль</span>
              <input
                type="password"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={resetNewPassword}
                onChange={(event) => setResetNewPassword(event.target.value)}
                minLength={8}
                maxLength={72}
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-700">Підтвердження нового пароля</span>
              <input
                type="password"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={resetConfirmPassword}
                onChange={(event) => setResetConfirmPassword(event.target.value)}
                minLength={8}
                maxLength={72}
                required
              />
            </label>
          </div>

          {resetError && <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{resetError}</p>}
          {resetNotice && <p className="mt-3 rounded-md bg-skyline p-2 text-sm text-pine">{resetNotice}</p>}

          <button
            disabled={resetSubmitting}
            className="mt-3 w-full rounded-lg border border-pine bg-white px-4 py-2 text-sm font-semibold text-pine disabled:opacity-50"
          >
            {resetSubmitting ? "Скидаємо..." : "Скинути пароль адміністратора"}
          </button>
        </form>
      </div>
    </div>
  );
}
