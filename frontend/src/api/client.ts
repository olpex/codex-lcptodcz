const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";

interface RequestOptions extends RequestInit {
  token?: string | null;
}

function mapStatusToMessage(status: number): string {
  if (status <= 0) return "Не вдалося підключитися до сервера. Перевірте інтернет-з'єднання.";
  if (status === 400) return "Некоректний запит. Перевірте введені дані.";
  if (status === 401) return "Сесія завершилась або вказані невірні облікові дані.";
  if (status === 403) return "У вас недостатньо прав для цієї дії.";
  if (status === 404) return "Запитаний ресурс не знайдено.";
  if (status === 409) return "Конфлікт даних. Оновіть сторінку та спробуйте ще раз.";
  if (status === 422) return "Дані не пройшли валідацію.";
  if (status >= 500) return "Внутрішня помилка сервера. Спробуйте ще раз пізніше.";
  return `Помилка запиту (${status}).`;
}

function sanitizeTechnicalMessage(rawMessage: string, status: number): string {
  const trimmed = rawMessage.trim();
  if (!trimmed) {
    return mapStatusToMessage(status);
  }

  const withoutApiPath = trimmed
    .replace(/\s*\((?:https?:\/\/\S+|\/api\/[^)]+)\)\s*$/gi, "")
    .replace(/\brequest url:\s*(?:https?:\/\/\S+|\/api\/\S+)/gi, "")
    .replace(/\burl:\s*(?:https?:\/\/\S+|\/api\/\S+)/gi, "")
    .replace(/\b\/api\/[^\s)]+/gi, "")
    .replace(/https?:\/\/[^\s)]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!withoutApiPath) {
    return mapStatusToMessage(status);
  }

  if (/traceback|stack trace|at\s+\S+|line\s+\d+/i.test(withoutApiPath)) {
    return mapStatusToMessage(status);
  }

  if (/^api error\s*\d+$/i.test(withoutApiPath) || /^api помилка\s*\d+$/i.test(withoutApiPath)) {
    return mapStatusToMessage(status);
  }

  if (/^not found$/i.test(withoutApiPath)) {
    return mapStatusToMessage(404);
  }
  if (/^unauthorized$/i.test(withoutApiPath)) {
    return mapStatusToMessage(401);
  }
  if (/^forbidden$/i.test(withoutApiPath)) {
    return mapStatusToMessage(403);
  }
  if (/^internal server error$/i.test(withoutApiPath)) {
    return mapStatusToMessage(500);
  }

  if (/(?:^|\s)(?:err(or)?|exception|failure|fatal)(?:\s|:|$)/i.test(withoutApiPath) && withoutApiPath.length > 120) {
    return mapStatusToMessage(status);
  }

  return withoutApiPath;
}

function parsePayloadMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if ("errors" in payload && Array.isArray(payload.errors) && payload.errors.length > 0) {
    return "Дані не пройшли валідацію. Перевірте заповнення полів.";
  }
  if ("detail" in payload && Array.isArray(payload.detail)) {
    return "Дані не пройшли валідацію. Перевірте заповнення полів.";
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
    const payloadMessage = parsePayloadMessage(payload);
    const message = payloadMessage
      ? sanitizeTechnicalMessage(payloadMessage, response.status)
      : mapStatusToMessage(response.status);
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

export { API_URL };
