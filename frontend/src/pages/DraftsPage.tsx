import { useEffect, useMemo, useState } from "react";
import { createWorker, OEM, PSM } from "tesseract.js";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { formatDraftStatus, formatMailStatus } from "../i18n/statuses";
import { Panel } from "../components/Panel";
import { TrendStatCard } from "../components/TrendStatCard";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { usePageRefresh } from "../hooks/usePageRefresh";
import type { Draft, MailMessage } from "../types/api";

type EditablePayload = {
  first_name?: string;
  last_name?: string;
  status?: string;
  order_number?: string;
  group_code?: string;
  contract_number?: string;
  birth_date?: string;
  phone?: string;
  email?: string;
  entries?: unknown[];
  raw_text?: string;
  source?: string;
};

type DraftStatsSnapshot = {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  avgConfidencePct: number;
};

const STATS_HISTORY_LIMIT = 12;

async function prepareImageForBrowserOcr(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.max(2, Math.min(3, 2200 / Math.max(bitmap.width, 1)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Браузер не зміг підготувати зображення для OCR");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index];
    const green = imageData.data[index + 1];
    const blue = imageData.data[index + 2];
    const gray = red * 0.299 + green * 0.587 + blue * 0.114;
    const enhanced = gray > 215 ? 255 : Math.max(0, gray - 35);
    imageData.data[index] = enhanced;
    imageData.data[index + 1] = enhanced;
    imageData.data[index + 2] = enhanced;
    imageData.data[index + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  bitmap.close();
  return canvas;
}

async function recognizeImageInBrowser(file: File, onProgress: (message: string) => void): Promise<string> {
  onProgress("Готую зображення...");
  const image = await prepareImageForBrowserOcr(file);
  const worker = await createWorker(["ukr", "eng"], OEM.LSTM_ONLY, {
    logger: (message) => {
      if (!message.status) return;
      const percent = Math.round((message.progress || 0) * 100);
      onProgress(percent > 0 ? `${message.status}: ${percent}%` : message.status);
    }
  });
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300"
    });
    onProgress("Розпізнаю текст у браузері...");
    const result = await worker.recognize(image);
    return (result.data.text || "").trim();
  } finally {
    await worker.terminate();
  }
}

function getDraftRowClassName(draft: Draft): string | undefined {
  if (draft.status === "rejected") return "bg-rose-50";
  if (draft.status === "pending" || draft.confidence < 0.7) return "bg-amber-50";
  return undefined;
}

function getDraftConfidenceClass(confidence: number): string {
  if (confidence < 0.55) return "bg-rose-100 text-rose-700";
  if (confidence < 0.7) return "bg-amber-100 text-amber-800";
  return "bg-emerald-100 text-emerald-700";
}

export function DraftsPage() {
  const { request, user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<number | null>(null);
  const [draftType, setDraftType] = useState("trainee_card");
  const [confidence, setConfidence] = useState(0.75);
  const [payload, setPayload] = useState<EditablePayload>({});
  const [payloadJson, setPayloadJson] = useState("{}");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageDraftType, setImageDraftType] = useState("auto");
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [ocrProgress, setOcrProgress] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statsHistory, setStatsHistory] = useState<DraftStatsSnapshot[]>([]);

  const buildSnapshot = (draftRows: Draft[]): DraftStatsSnapshot => {
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    let confidenceSum = 0;
    for (const row of draftRows) {
      if (row.status === "pending") pending += 1;
      if (row.status === "approved") approved += 1;
      if (row.status === "rejected") rejected += 1;
      confidenceSum += row.confidence || 0;
    }
    const avgConfidencePct = draftRows.length ? Number(((confidenceSum / draftRows.length) * 100).toFixed(1)) : 0;
    return {
      total: draftRows.length,
      pending,
      approved,
      rejected,
      avgConfidencePct
    };
  };

  const appendSnapshot = (draftRows: Draft[]) => {
    const snapshot = buildSnapshot(draftRows);
    setStatsHistory((prev) => {
      const next = [...prev, snapshot];
      if (next.length <= STATS_HISTORY_LIMIT) return next;
      return next.slice(next.length - STATS_HISTORY_LIMIT);
    });
  };

  const canEdit = useMemo(
    () => user?.roles.some((role) => role.name === "admin" || role.name === "methodist") ?? false,
    [user]
  );

  const selectedDraft = useMemo(
    () => drafts.find((draft) => draft.id === selectedDraftId) || null,
    [drafts, selectedDraftId]
  );

  const mailColumns = useMemo<DataTableColumn<MailMessage>[]>(
    () => [
      {
        key: "received_at",
        header: "Дата",
        render: (message) => new Date(message.received_at).toLocaleString("uk-UA"),
        sortAccessor: (message) => message.received_at
      },
      {
        key: "sender",
        header: "Відправник",
        render: (message) => message.sender,
        sortAccessor: (message) => message.sender
      },
      {
        key: "subject",
        header: "Тема",
        render: (message) => message.subject,
        sortAccessor: (message) => message.subject
      },
      {
        key: "status",
        header: "Статус",
        render: (message) => formatMailStatus(message.status),
        sortAccessor: (message) => formatMailStatus(message.status)
      }
    ],
    []
  );

  const draftColumns = useMemo<DataTableColumn<Draft>[]>(
    () => [
      {
        key: "id",
        header: "ID",
        render: (draft) => draft.id,
        sortAccessor: (draft) => draft.id
      },
      {
        key: "draft_type",
        header: "Тип",
        render: (draft) => draft.draft_type,
        sortAccessor: (draft) => draft.draft_type
      },
      {
        key: "confidence",
        header: "Довіра",
        render: (draft) => (
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${getDraftConfidenceClass(draft.confidence)}`}>
            {(draft.confidence * 100).toFixed(0)}%
          </span>
        ),
        sortAccessor: (draft) => draft.confidence
      },
      {
        key: "status",
        header: "Статус",
        render: (draft) => formatDraftStatus(draft.status),
        sortAccessor: (draft) => formatDraftStatus(draft.status)
      },
      {
        key: "actions",
        header: "Вибір",
        render: (draft) => (
          <button
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              draft.id === selectedDraftId ? "bg-pine text-white" : "bg-slate-100 text-slate-700"
            }`}
            onClick={() => applyDraftToForm(draft)}
          >
            Відкрити
          </button>
        )
      }
    ],
    [selectedDraftId]
  );

  const applyDraftToForm = (draft: Draft) => {
    const draftPayload = (draft.structured_payload || {}) as EditablePayload;
    setSelectedDraftId(draft.id);
    setDraftType(draft.draft_type || "trainee_card");
    setConfidence(Number.isFinite(draft.confidence) ? draft.confidence : 0.75);
    setPayloadJson(JSON.stringify(draftPayload, null, 2));
    setPayload({
      first_name: typeof draftPayload.first_name === "string" ? draftPayload.first_name : "",
      last_name: typeof draftPayload.last_name === "string" ? draftPayload.last_name : "",
      status: typeof draftPayload.status === "string" ? draftPayload.status : "draft",
      order_number: typeof draftPayload.order_number === "string" ? draftPayload.order_number : "",
      group_code: typeof draftPayload.group_code === "string" ? draftPayload.group_code : "",
      contract_number: typeof draftPayload.contract_number === "string" ? draftPayload.contract_number : "",
      birth_date: typeof draftPayload.birth_date === "string" ? draftPayload.birth_date : "",
      phone: typeof draftPayload.phone === "string" ? draftPayload.phone : "",
      email: typeof draftPayload.email === "string" ? draftPayload.email : ""
    });
  };

  const load = async () => {
    setIsLoading(true);
    try {
      const [draftRows, mailRows] = await Promise.all([
        request<Draft[]>("/drafts"),
        request<MailMessage[]>("/mail/messages")
      ]);
      setDrafts(draftRows);
      setMessages(mailRows);
      appendSnapshot(draftRows);
      setLoadError(null);

      if (!selectedDraftId && draftRows.length > 0) {
        applyDraftToForm(draftRows[0]);
      } else if (selectedDraftId) {
        const refreshed = draftRows.find((item) => item.id === selectedDraftId);
        if (refreshed) applyDraftToForm(refreshed);
      }
    } catch (error) {
      const message = (error as Error).message;
      setLoadError(message);
      showError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  usePageRefresh(load, { intervalMs: 30_000 });

  const pollNow = async () => {
    try {
      await request("/mail/poll-now", { method: "POST" });
      showSuccess("Опитування поштової скриньки запущено");
      await load();
    } catch (error) {
      showError((error as Error).message);
    }
  };

  const saveDraft = async () => {
    if (!selectedDraftId) return;
    try {
      let nextPayload: EditablePayload;
      if (draftType === "schedule") {
        try {
          nextPayload = JSON.parse(payloadJson || "{}") as EditablePayload;
        } catch {
          showError("Структуровані дані розкладу мають бути коректним JSON");
          return;
        }
      } else if (draftType === "order") {
        nextPayload = {
          order_number: payload.order_number || `AUTO-${selectedDraftId}`,
          status: payload.status || "draft"
        };
      } else {
        nextPayload = {
          first_name: payload.first_name || "Невідомо",
          last_name: payload.last_name || "Невідомо",
          status: payload.status || "active",
          group_code: payload.group_code || "",
          contract_number: payload.contract_number || "",
          birth_date: payload.birth_date || "",
          phone: payload.phone || "",
          email: payload.email || ""
        };
      }

      await request<Draft>(`/drafts/${selectedDraftId}`, {
        method: "PATCH",
        body: JSON.stringify({
          draft_type: draftType,
          confidence,
          structured_payload: nextPayload
        })
      });
      showSuccess(`Чернетка ${selectedDraftId} збережена`);
      await load();
    } catch (error) {
      showError((error as Error).message);
    }
  };

  const uploadImageDraft = async () => {
    if (!imageFile) {
      showError("Оберіть скріншот або фото документа");
      return;
    }
    setIsUploadingImage(true);
    setOcrProgress("");
    try {
      let browserText = "";
      try {
        browserText = await recognizeImageInBrowser(imageFile, setOcrProgress);
      } catch (ocrError) {
        console.warn("Browser OCR failed, falling back to server OCR", ocrError);
        setOcrProgress("Браузерний OCR не спрацював, пробую серверний OCR...");
      }
      const formData = new FormData();
      formData.append("file", imageFile);
      formData.append("draft_type", imageDraftType);
      formData.append("extracted_text", browserText);
      const draft = await request<Draft>("/drafts/upload-image", {
        method: "POST",
        body: formData
      });
      showSuccess(`OCR-чернетку #${draft.id} створено`);
      await load();
      applyDraftToForm(draft);
      setImageFile(null);
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setIsUploadingImage(false);
      setOcrProgress("");
    }
  };

  const approveDraft = async () => {
    if (!selectedDraftId) return;
    try {
      await request(`/drafts/${selectedDraftId}/approve`, { method: "POST" });
      showSuccess(`Чернетка ${selectedDraftId} підтверджена`);
      await load();
    } catch (error) {
      showError((error as Error).message);
    }
  };

  const reprocessDraft = async () => {
    if (!selectedDraftId) return;
    try {
      await request(`/drafts/${selectedDraftId}/reprocess`, { method: "POST" });
      showSuccess(`Чернетка ${selectedDraftId} надіслана на повторний парсинг`);
      await load();
    } catch (error) {
      showError((error as Error).message);
    }
  };

  const seriesByKey = useMemo(
    () => ({
      total: statsHistory.map((item) => item.total),
      pending: statsHistory.map((item) => item.pending),
      approved: statsHistory.map((item) => item.approved),
      rejected: statsHistory.map((item) => item.rejected),
      avgConfidencePct: statsHistory.map((item) => item.avgConfidencePct)
    }),
    [statsHistory]
  );

  return (
    <div className="space-y-5">
      <Panel title="Імпорт зі скріншота">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-end">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Скріншот або фото документа
            </span>
            <input
              disabled={!canEdit || isUploadingImage}
              type="file"
              accept="image/*"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              onChange={(event) => setImageFile(event.target.files?.[0] || null)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Тип</span>
            <select
              disabled={!canEdit || isUploadingImage}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              value={imageDraftType}
              onChange={(event) => setImageDraftType(event.target.value)}
            >
              <option value="auto">Автоматично</option>
              <option value="schedule">Розклад</option>
              <option value="trainee_card">Договір / слухач</option>
              <option value="order">Наказ</option>
            </select>
          </label>
          <button
            disabled={!canEdit || isUploadingImage || !imageFile}
            className="rounded-lg bg-pine px-4 py-2 font-semibold text-white disabled:opacity-40"
            onClick={uploadImageDraft}
          >
            {isUploadingImage ? "Розпізнаю..." : "Розпізнати скріншот"}
          </button>
        </div>
        {ocrProgress && <p className="mt-2 text-sm text-slate-600">{ocrProgress}</p>}
      </Panel>

      <Panel title="Вхідна кореспонденція">
        <div className="mb-3 flex items-center gap-3">
          {canEdit && (
            <button className="rounded-lg bg-pine px-4 py-2 font-semibold text-white" onClick={pollNow}>
              Опитати пошту зараз
            </button>
          )}
          <button className="rounded-lg bg-amber px-4 py-2 font-semibold text-ink" onClick={load}>
            Оновити
          </button>
        </div>
        <DataTable
          data={messages}
          columns={mailColumns}
          rowKey={(message) => message.id}
          isLoading={isLoading}
          errorText={loadError}
          onRetry={load}
          emptyText="Листи відсутні"
          emptyActionLabel="Оновити листи"
          onEmptyAction={load}
          emptyActionDisabled={isLoading}
          search={{
            placeholder: "Пошук за відправником або темою",
            getSearchText: (message) => `${message.sender} ${message.subject} ${message.status} ${formatMailStatus(message.status)}`
          }}
          initialPageSize={20}
        />
      </Panel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Panel title="Чернетки OCR">
          <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {[
              { key: "total", title: "Усього чернеток", series: seriesByKey.total, suffix: "" },
              { key: "pending", title: "Очікують підтвердження", series: seriesByKey.pending, suffix: "" },
              { key: "approved", title: "Підтверджені", series: seriesByKey.approved, suffix: "" },
              { key: "rejected", title: "Відхилені", series: seriesByKey.rejected, suffix: "" },
              { key: "avgConfidencePct", title: "Середня довіра OCR", series: seriesByKey.avgConfidencePct, suffix: "%" }
            ].map((item) => {
              const current = item.series.length ? item.series[item.series.length - 1] : 0;
              const previous = item.series.length > 1 ? item.series[item.series.length - 2] : null;
              const delta = previous == null ? null : Number((current - previous).toFixed(1));
              const valueLabel = `${current.toLocaleString("uk-UA")}${item.suffix}`;
              return (
                <TrendStatCard
                  key={item.key}
                  title={item.title}
                  valueLabel={valueLabel}
                  delta={delta}
                  deltaSuffix={item.suffix === "%" ? " п.п." : ""}
                  series={item.series}
                  sparklineLabel={`${item.title}: тренд за останні оновлення`}
                />
              );
            })}
          </div>
          <DataTable
            data={drafts}
            columns={draftColumns}
            rowKey={(draft) => draft.id}
            isLoading={isLoading}
            errorText={loadError}
            onRetry={load}
            rowClassName={getDraftRowClassName}
            emptyText="Чернетки відсутні"
            emptyActionLabel="Оновити чернетки"
            onEmptyAction={load}
            emptyActionDisabled={isLoading}
            search={{
              placeholder: "Пошук за типом або статусом",
              getSearchText: (draft) => `${draft.id} ${draft.draft_type} ${draft.status} ${formatDraftStatus(draft.status)}`
            }}
          />
        </Panel>

        <Panel title="Редактор чернетки">
          {!selectedDraft ? (
            <p className="text-sm text-slate-600">Оберіть чернетку зі списку.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                ID: <span className="font-semibold text-ink">{selectedDraft.id}</span>
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Тип</span>
                  <select
                    disabled={!canEdit || selectedDraft.status === "approved"}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={draftType}
                    onChange={(event) => setDraftType(event.target.value)}
                  >
                    <option value="trainee_card">Картка слухача</option>
                    <option value="schedule">Розклад</option>
                    <option value="order">Наказ</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Довіра (0..1)
                  </span>
                  <input
                    disabled={!canEdit || selectedDraft.status === "approved"}
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={confidence}
                    onChange={(event) => setConfidence(Number(event.target.value))}
                  />
                </label>
              </div>

              {draftType === "schedule" ? (
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Структуровані дані розкладу
                  </span>
                  <textarea
                    disabled={!canEdit || selectedDraft.status === "approved"}
                    className="min-h-64 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                    value={payloadJson}
                    onChange={(event) => setPayloadJson(event.target.value)}
                  />
                </label>
              ) : draftType === "order" ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    disabled={!canEdit || selectedDraft.status === "approved"}
                    className="rounded-lg border border-slate-300 px-3 py-2"
                    placeholder="Номер наказу"
                    value={payload.order_number || ""}
                    onChange={(event) => setPayload((prev) => ({ ...prev, order_number: event.target.value }))}
                  />
                  <input
                    disabled={!canEdit || selectedDraft.status === "approved"}
                    className="rounded-lg border border-slate-300 px-3 py-2"
                    placeholder="Статус"
                    value={payload.status || ""}
                    onChange={(event) => setPayload((prev) => ({ ...prev, status: event.target.value }))}
                  />
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    disabled={!canEdit || selectedDraft.status === "approved"}
                    className="rounded-lg border border-slate-300 px-3 py-2"
                    placeholder="Ім'я"
                    value={payload.first_name || ""}
                    onChange={(event) => setPayload((prev) => ({ ...prev, first_name: event.target.value }))}
                  />
                  <input
                    disabled={!canEdit || selectedDraft.status === "approved"}
                    className="rounded-lg border border-slate-300 px-3 py-2"
                    placeholder="Прізвище"
                    value={payload.last_name || ""}
                    onChange={(event) => setPayload((prev) => ({ ...prev, last_name: event.target.value }))}
                  />
                  <input
                    disabled={!canEdit || selectedDraft.status === "approved"}
                    className="rounded-lg border border-slate-300 px-3 py-2 md:col-span-2"
                    placeholder="Статус"
                    value={payload.status || ""}
                    onChange={(event) => setPayload((prev) => ({ ...prev, status: event.target.value }))}
                  />
                  <input
                    disabled={!canEdit || selectedDraft.status === "approved"}
                    className="rounded-lg border border-slate-300 px-3 py-2"
                    placeholder="Група"
                    value={payload.group_code || ""}
                    onChange={(event) => setPayload((prev) => ({ ...prev, group_code: event.target.value }))}
                  />
                  <input
                    disabled={!canEdit || selectedDraft.status === "approved"}
                    className="rounded-lg border border-slate-300 px-3 py-2"
                    placeholder="Номер договору"
                    value={payload.contract_number || ""}
                    onChange={(event) => setPayload((prev) => ({ ...prev, contract_number: event.target.value }))}
                  />
                  <input
                    disabled={!canEdit || selectedDraft.status === "approved"}
                    className="rounded-lg border border-slate-300 px-3 py-2"
                    placeholder="Дата народження"
                    type="date"
                    value={payload.birth_date || ""}
                    onChange={(event) => setPayload((prev) => ({ ...prev, birth_date: event.target.value }))}
                  />
                  <input
                    disabled={!canEdit || selectedDraft.status === "approved"}
                    className="rounded-lg border border-slate-300 px-3 py-2"
                    placeholder="Телефон"
                    value={payload.phone || ""}
                    onChange={(event) => setPayload((prev) => ({ ...prev, phone: event.target.value }))}
                  />
                  <input
                    disabled={!canEdit || selectedDraft.status === "approved"}
                    className="rounded-lg border border-slate-300 px-3 py-2 md:col-span-2"
                    placeholder="Email"
                    value={payload.email || ""}
                    onChange={(event) => setPayload((prev) => ({ ...prev, email: event.target.value }))}
                  />
                </div>
              )}

              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  OCR текст (read-only)
                </span>
                <textarea
                  readOnly
                  className="min-h-28 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
                  value={selectedDraft.extracted_text || ""}
                />
              </label>

              <div className="flex flex-wrap gap-2">
                {canEdit && (
                  <button
                    disabled={selectedDraft.status === "approved"}
                    className="rounded-lg bg-pine px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                    onClick={saveDraft}
                  >
                    Зберегти зміни
                  </button>
                )}
                {canEdit && (
                  <button
                    disabled={selectedDraft.status === "approved"}
                    className="rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-ink disabled:opacity-40"
                    onClick={approveDraft}
                  >
                    Підтвердити
                  </button>
                )}
                {canEdit && (
                  <button
                    disabled={selectedDraft.status === "approved"}
                    className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-40"
                    onClick={reprocessDraft}
                  >
                    Перепарсити OCR
                  </button>
                )}
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
