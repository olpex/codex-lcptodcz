import { useCallback, useRef } from "react";

type ApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

const MIN_INTERVAL_MS = 30_000;

export function useJournalAutoTick(request: ApiRequest, enabled = true) {
  const lastRunRef = useRef(0);
  const inFlightRef = useRef(false);

  return useCallback(() => {
    if (!enabled || inFlightRef.current) return;
    const now = Date.now();
    if (now - lastRunRef.current < MIN_INTERVAL_MS) return;

    inFlightRef.current = true;
    lastRunRef.current = now;
    void request<{ processed_sections: number; failed_sections: number }>("/journal-monitors/auto-tick", {
      method: "POST"
    })
      .catch(() => {
        // Data refresh must stay usable even if Drive is temporarily unavailable.
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, [enabled, request]);
}
