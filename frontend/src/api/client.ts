const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";

interface RequestOptions extends RequestInit {
  token?: string | null;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  const requestUrl = `${API_URL}${path}`;
  let response: Response;
  try {
    response = await fetch(requestUrl, {
      ...options,
      headers
    });
  } catch {
    const error = new Error(`Не вдалося підключитися до API (${API_URL})`) as Error & { status?: number };
    error.status = 0;
    throw error;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const fallback =
      payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : `API помилка ${response.status} (${requestUrl})`;
    const detail =
      payload && typeof payload === "object" && "detail" in payload && typeof payload.detail === "string"
        ? payload.detail
        : null;
    const message = detail ? `${detail} (${requestUrl})` : fallback;
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

export { API_URL };
