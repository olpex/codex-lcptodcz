import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { uiText } from "../i18n/uk";

export function LoginPage() {
  const { login, user } = useAuth();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("Admin123!");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_right,#d8ecf2_0%,#f2f7f5_50%,#ffffff_100%)] px-4">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-3xl bg-white p-8 shadow-card">
        <h1 className="font-heading text-3xl font-bold text-pine">{uiText.appTitle}</h1>
        <p className="mb-6 mt-2 text-sm text-slate-600">{uiText.appSubtitle}</p>
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
    </div>
  );
}

