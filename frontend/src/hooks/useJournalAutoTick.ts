import { useCallback, useRef } from "react";

type ApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

const MIN_INTERVAL_MS = 45_000;

type AutoTickResult = {
  processed_sections: number;
  failed_sections: number;
  drive_intake_processed?: number;
  drive_intake_failed?: number;
  drive_intake_disabled?: number;
  drive_intake_skipped_already_processed?: number;
  drive_intake_skipped_unsupported?: number;
  drive_intake_job_id?: number | null;
  drive_intake_filename?: string | null;
};

export function useJournalAutoTick(request: ApiRequest, enabled = true): () => Promise<AutoTickResult | null> | undefined {
  const lastRunRef = useRef(0);
  const inFlightRef = useRef<Promise<AutoTickResult | null> | null>(null);

  return useCallback(() => {
    if (!enabled || inFlightRef.current) return;

    const now = Date.now();
    if (now - lastRunRef.current < MIN_INTERVAL_MS) return;

    lastRunRef.current = now;
    const tickPromise = request<AutoTickResult>("/journal-monitors/auto-tick", {
      method: "POST"
    })
      .catch(() => {
        // Data refresh must stay usable even if Drive is temporarily unavailable.
        return null;
      })
      .finally(() => {
        inFlightRef.current = null;
      });
    inFlightRef.current = tickPromise;
    return tickPromise;
  }, [enabled, request]);
}
