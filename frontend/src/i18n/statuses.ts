import type { Job } from "../types/api";

export const JOB_TYPE_LABELS: Record<"import" | "export", string> = {
  import: "Імпорт",
  export: "Експорт"
};

export const JOB_STATUS_LABELS: Record<Job["status"], string> = {
  queued: "У черзі",
  running: "Виконується",
  succeeded: "Успішно",
  failed: "Помилка"
};

export const GROUP_STATUS_LABELS: Record<string, string> = {
  planned: "Запланована",
  active: "Активна",
  completed: "Завершена",
  archived: "Архівна"
};

export const DRAFT_STATUS_LABELS: Record<"pending" | "approved" | "rejected", string> = {
  pending: "Очікує підтвердження",
  approved: "Підтверджено",
  rejected: "Відхилено"
};

export const MAIL_STATUS_LABELS: Record<string, string> = {
  new: "Новий",
  queued: "У черзі",
  running: "Обробляється",
  processed: "Опрацьовано",
  approved: "Підтверджено",
  failed: "Помилка",
  rejected: "Відхилено",
  ignored: "Пропущено"
};

export function formatJobType(value: string | null | undefined): string {
  if (!value) return "—";
  return JOB_TYPE_LABELS[value as keyof typeof JOB_TYPE_LABELS] || value;
}

export function formatJobStatus(value: string | null | undefined): string {
  if (!value) return "—";
  return JOB_STATUS_LABELS[value as keyof typeof JOB_STATUS_LABELS] || value;
}

export function formatGroupStatus(value: string | null | undefined): string {
  if (!value) return "—";
  return GROUP_STATUS_LABELS[value] || value;
}

export function formatDraftStatus(value: string | null | undefined): string {
  if (!value) return "—";
  return DRAFT_STATUS_LABELS[value as keyof typeof DRAFT_STATUS_LABELS] || value;
}

export function formatMailStatus(value: string | null | undefined): string {
  if (!value) return "—";
  return MAIL_STATUS_LABELS[value] || value;
}
