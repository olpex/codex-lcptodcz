import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { InlineNotice } from "../components/InlineNotice";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { formatJobStatus, formatJobType } from "../i18n/statuses";
import type { Group, JobListItem, Order, Performance, ScheduleSlot, Trainee, Workload } from "../types/api";

type SearchResult = {
  id: string;
  section: string;
  title: string;
  description: string;
  href: string;
  tokens: string;
  tone?: "warning" | "error";
};

function normalize(value: string): string {
  return value.toLocaleLowerCase("uk-UA").trim();
}

function matchesQuery(tokens: string, query: string): boolean {
  const normalizedTokens = normalize(tokens);
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return terms.every((term) => normalizedTokens.includes(term));
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("uk-UA");
}

function resultToneClass(tone: SearchResult["tone"]): string {
  if (tone === "error") return "border-rose-200 bg-rose-50";
  if (tone === "warning") return "border-amber-200 bg-amber-50";
  return "border-slate-200 bg-white";
}

export function SearchPage() {
  const { request, user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [schedule, setSchedule] = useState<ScheduleSlot[]>([]);
  const [workload, setWorkload] = useState<Workload[]>([]);
  const [performance, setPerformance] = useState<Performance[]>([]);
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const userRoles = user?.roles.map((role) => role.name) || [];
  const canManage = userRoles.includes("admin") || userRoles.includes("methodist");

  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const traineeById = useMemo(() => new Map(trainees.map((trainee) => [trainee.id, trainee])), [trainees]);

  const loadSearchIndex = async (showToast = false) => {
    setIsLoading(true);
    const failures: string[] = [];
    const tasks: Promise<void>[] = [
      request<ScheduleSlot[]>("/schedule")
        .then(setSchedule)
        .catch((error) => {
          failures.push(`Розклад: ${(error as Error).message}`);
        }),
      request<Workload[]>("/teacher-workload")
        .then(setWorkload)
        .catch((error) => {
          failures.push(`Навантаження: ${(error as Error).message}`);
        }),
      request<Performance[]>("/performance")
        .then(setPerformance)
        .catch((error) => {
          failures.push(`Успішність: ${(error as Error).message}`);
        })
    ];

    if (canManage) {
      tasks.push(
        request<Group[]>("/groups")
          .then(setGroups)
          .catch((error) => {
            failures.push(`Групи: ${(error as Error).message}`);
          }),
        request<Trainee[]>("/trainees?include_deleted=true")
          .then(setTrainees)
          .catch((error) => {
            failures.push(`Слухачі: ${(error as Error).message}`);
          }),
        request<Order[]>("/orders")
          .then(setOrders)
          .catch((error) => {
            failures.push(`Накази: ${(error as Error).message}`);
          }),
        request<JobListItem[]>("/jobs?limit=200")
          .then(setJobs)
          .catch((error) => {
            failures.push(`Задачі: ${(error as Error).message}`);
          })
      );
    }

    await Promise.all(tasks);
    setIsLoading(false);

    if (failures.length) {
      const message = `Частину даних не вдалося завантажити. ${failures[0]}`;
      setLoadError(message);
      showError(message);
      return;
    }

    setLoadError(null);
    if (showToast) showSuccess("Пошуковий індекс оновлено");
  };

  useEffect(() => {
    loadSearchIndex();
  }, [canManage]);

  const allResults = useMemo<SearchResult[]>(() => {
    const groupResults = groups.map((group) => ({
      id: `group-${group.id}`,
      section: "Групи",
      title: `${group.code} — ${group.name}`,
      description: `Статус: ${group.status}. Місткість: ${group.capacity}`,
      href: "/groups",
      tokens: `${group.code} ${group.name} ${group.status} ${group.start_date || ""} ${group.end_date || ""}`
    }));

    const traineeResults = trainees.map((trainee) => ({
      id: `trainee-${trainee.id}`,
      section: "Слухачі",
      title: `${trainee.last_name} ${trainee.first_name}`,
      description: `Група: ${trainee.group_code || "без групи"}. Договір: ${trainee.contract_number || "—"}`,
      href: "/trainees",
      tokens: `${trainee.last_name} ${trainee.first_name} ${trainee.group_code || ""} ${trainee.contract_number || ""} ${trainee.phone || ""} ${trainee.email || ""}`,
      tone: trainee.is_deleted ? "warning" as const : undefined
    }));

    const orderResults = orders.map((order) => ({
      id: `order-${order.id}`,
      section: "Накази",
      title: order.order_number,
      description: `Тип: ${order.order_type}. Статус: ${order.status}. Дата: ${order.order_date}`,
      href: "/orders",
      tokens: `${order.order_number} ${order.order_type} ${order.status} ${order.order_date}`
    }));

    const scheduleResults = schedule.map((slot) => ({
      id: `schedule-${slot.id}`,
      section: "Розклад",
      title: `${slot.group_code || "Група"} — ${slot.subject_name || "Заняття"}`,
      description: `${formatDateTime(slot.starts_at)}. Викладач: ${slot.teacher_name || "—"}`,
      href: "/schedule",
      tokens: `${slot.group_code || ""} ${slot.group_name || ""} ${slot.subject_name || ""} ${slot.teacher_name || ""} ${slot.starts_at}`
    }));

    const workloadResults = workload.map((row) => ({
      id: `workload-${row.teacher_id}`,
      section: "Навантаження",
      title: row.teacher_name,
      description: `Годин: ${row.total_hours}. Річне: ${row.annual_load_hours}. Залишок: ${row.remaining_hours}`,
      href: "/workload",
      tokens: `${row.teacher_name} ${row.total_hours} ${row.annual_load_hours} ${row.remaining_hours}`,
      tone: row.remaining_hours < 0 ? "error" as const : row.remaining_hours === 0 ? "warning" as const : undefined
    }));

    const performanceResults = performance.map((item) => {
      const group = groupById.get(item.group_id);
      const trainee = traineeById.get(item.trainee_id);
      const traineeName = trainee ? `${trainee.last_name} ${trainee.first_name}` : `Слухач #${item.trainee_id}`;
      const groupName = group ? `${group.code} ${group.name}` : `Група #${item.group_id}`;
      return {
        id: `performance-${item.id}`,
        section: "Успішність",
        title: traineeName,
        description: `${groupName}. Прогрес: ${item.progress_pct}%. Відвідування: ${item.attendance_pct}%`,
        href: "/performance",
        tokens: `${traineeName} ${groupName} ${item.progress_pct} ${item.attendance_pct}`,
        tone: item.progress_pct < 60 || item.attendance_pct < 70 ? "error" as const : undefined
      };
    });

    const jobResults = jobs.map((item) => ({
      id: `job-${item.job_type}-${item.job.id}`,
      section: "Центр імпорту",
      title: `#${item.job.id} ${formatJobType(item.job_type)}`,
      description: `${formatJobStatus(item.job.status)}. ${item.job.message || item.document_file_name || item.output_file_name || "Без повідомлення"}`,
      href: "/jobs",
      tokens: `${item.job.id} ${item.job_type} ${formatJobType(item.job_type)} ${item.job.status} ${formatJobStatus(item.job.status)} ${item.job.message || ""} ${item.document_file_name || ""} ${item.output_file_name || ""}`,
      tone: item.job.status === "failed" ? "error" as const : item.job.status === "queued" || item.job.status === "running" ? "warning" as const : undefined
    }));

    return [
      ...groupResults,
      ...traineeResults,
      ...orderResults,
      ...scheduleResults,
      ...workloadResults,
      ...performanceResults,
      ...jobResults
    ];
  }, [groupById, groups, jobs, orders, performance, schedule, traineeById, trainees, workload]);

  const visibleResults = useMemo(() => {
    if (!query.trim()) return [];
    return allResults.filter((result) => matchesQuery(result.tokens, query)).slice(0, 80);
  }, [allResults, query]);

  const resultCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const result of visibleResults) {
      counts.set(result.section, (counts.get(result.section) || 0) + 1);
    }
    return Array.from(counts.entries());
  }, [visibleResults]);

  return (
    <div className="space-y-5">
      <Panel title="2.8 Пошук по всій системі">
        {loadError && <InlineNotice className="mb-3" tone="error" text={loadError} />}
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[280px] flex-1">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Пошуковий запит</span>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Група, слухач, викладач, наказ, задача..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
            onClick={() => loadSearchIndex(true)}
            disabled={isLoading}
          >
            {isLoading ? "Оновлюємо..." : "Оновити дані"}
          </button>
          {query && (
            <button
              type="button"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
              onClick={() => setQuery("")}
            >
              Очистити
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
            Індекс: {allResults.length}
          </span>
          {resultCounts.map(([section, count]) => (
            <span key={section} className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
              {section}: {count}
            </span>
          ))}
        </div>
      </Panel>

      <Panel title="Результати пошуку">
        {!query.trim() && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
            Введіть слово, номер групи, прізвище, викладача або номер задачі.
          </div>
        )}
        {query.trim() && !visibleResults.length && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
            За цим запитом нічого не знайдено.
          </div>
        )}
        <div className="space-y-2">
          {visibleResults.map((result) => (
            <article key={result.id} className={`rounded-lg border px-3 py-3 ${resultToneClass(result.tone)}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{result.section}</p>
                  <h3 className="mt-1 truncate text-sm font-semibold text-ink">{result.title}</h3>
                  <p className="mt-1 text-sm text-slate-600">{result.description}</p>
                </div>
                <Link className="rounded-lg border border-pine px-3 py-1.5 text-xs font-semibold text-pine" to={result.href}>
                  Відкрити
                </Link>
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}
