import { useEffect, useRef } from "react";

export const PAGE_REFRESH_EVENT = "suptc:page-refresh";

type PageRefreshOptions = {
  enabled?: boolean;
  intervalMs?: number;
  refreshOnFocus?: boolean;
};

export function usePageRefresh(
  refresh: () => void | Promise<void>,
  { enabled = true, intervalMs = 60_000, refreshOnFocus = true }: PageRefreshOptions = {}
) {
  const refreshRef = useRef(refresh);
  const inFlightRef = useRef(false);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;

    const run = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        await refreshRef.current();
      } finally {
        inFlightRef.current = false;
      }
    };

    const handleManualRefresh = () => {
      void run();
    };

    const handleVisibilityChange = () => {
      if (refreshOnFocus && document.visibilityState === "visible") {
        void run();
      }
    };

    window.addEventListener(PAGE_REFRESH_EVENT, handleManualRefresh);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const timerId =
      intervalMs > 0
        ? window.setInterval(() => {
            if (document.visibilityState === "visible") {
              void run();
            }
          }, intervalMs)
        : null;

    return () => {
      window.removeEventListener(PAGE_REFRESH_EVENT, handleManualRefresh);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (timerId) {
        window.clearInterval(timerId);
      }
    };
  }, [enabled, intervalMs, refreshOnFocus]);
}
