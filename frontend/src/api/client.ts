const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";

interface RequestOptions extends RequestInit {
  token?: string | null;
}

function mapStatusToMessage(status: number): string {
  if (status === 400) return "Некоректний запит. Перевірте введені дані.";
  if (status === 401) return "Сесія завершилась або вказані невірні облікові дані.";
  if (status === 403) return "У вас недостатньо прав для цієї дії.";
  if (status === 404) return "Запитаний ресурс не знайдено.";
  if (status === 409) return "Конфлікт даних. Оновіть сторінку та спробуйте ще раз.";
  if (status === 422) return "Дані не пройшли валідацію.";
  if (status >= 500) return "Внутрішня помилка сервера. Спробуйте ще раз пізніше.";
  return `Помилка запиту (${status}).`;
}

function parsePayloadMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if ("message" in payload && typeof payload.message === "string") {
    return payload.message;
  }
  if ("detail" in payload && typeof payload.detail === "string") {
    return payload.detail;
  }
  return null;
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
    const error = new Error("Не вдалося підключитися до сервера. Перевірте інтернет-з'єднання.") as Error & {
      status?: number;
    };
    error.status = 0;
    throw error;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = parsePayloadMessage(payload) || mapStatusToMessage(response.status);
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

export { API_URL };
