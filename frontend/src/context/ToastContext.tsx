import { createContext, useCallback, useContext, useMemo, useState } from "react";

type ToastType = "success" | "error" | "info";

type ToastItem = {
  id: number;
  type: ToastType;
  message: string;
};

type ToastContextType = {
  showToast: (type: ToastType, message: string, durationMs?: number) => void;
  showSuccess: (message: string, durationMs?: number) => void;
  showError: (message: string, durationMs?: number) => void;
  showInfo: (message: string, durationMs?: number) => void;
};

const ToastContext = createContext<ToastContextType | null>(null);

function toastStyle(type: ToastType) {
  if (type === "success") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (type === "error") {
    return "border-red-200 bg-red-50 text-red-800";
  }
  return "border-skyline bg-skyline/70 text-pine";
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [nextId, setNextId] = useState(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const showToast = useCallback(
    (type: ToastType, message: string, durationMs = 4500) => {
      if (!message.trim()) return;

      setNextId((currentId) => {
        const id = currentId;
        setToasts((prev) => [...prev, { id, type, message }]);
        window.setTimeout(() => dismiss(id), durationMs);
        return currentId + 1;
      });
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({
      showToast,
      showSuccess: (message: string, durationMs?: number) => showToast("success", message, durationMs),
      showError: (message: string, durationMs?: number) => showToast("error", message, durationMs),
      showInfo: (message: string, durationMs?: number) => showToast("info", message, durationMs)
    }),
    [showToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-50 w-full max-w-sm space-y-2">
        {toasts.map((item) => (
          <div
            key={item.id}
            className={`pointer-events-auto rounded-lg border px-4 py-3 shadow-card ${toastStyle(item.type)}`}
            role={item.type === "error" ? "alert" : "status"}
            aria-live={item.type === "error" ? "assertive" : "polite"}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm">{item.message}</p>
              <button
                type="button"
                className="text-xs font-semibold opacity-80 hover:opacity-100"
                onClick={() => dismiss(item.id)}
                aria-label="Закрити сповіщення"
              >
                Закрити
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast має використовуватись всередині ToastProvider");
  }
  return context;
}
