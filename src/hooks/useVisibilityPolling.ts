import { useEffect, useRef, useCallback } from "react";

/**
 * Visibility-aware polling hook with AbortController support.
 * - Runs `callback` on an interval, passing an AbortSignal
 * - Pauses when the tab is hidden (document.visibilityState === "hidden")
 * - Resumes immediately when the tab becomes visible again (fires callback once)
 * - Aborts in-flight requests on new tick and on unmount
 *
 * @param callback  Async or sync function; receives AbortSignal to pass to fetch()
 * @param intervalMs  Polling interval in milliseconds
 * @param enabled  Whether polling is active (defaults to true)
 */
export function useVisibilityPolling(
  callback: (signal?: AbortSignal) => void | Promise<void>,
  intervalMs: number,
  enabled = true,
) {
  const callbackRef = useRef(callback);
  useEffect(() => { callbackRef.current = callback; }, [callback]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fireCallback = useCallback(() => {
    // Abort previous in-flight request
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    callbackRef.current(ac.signal);
  }, []);

  const startInterval = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fireCallback, intervalMs);
  }, [intervalMs, fireCallback]);

  const stopInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      stopInterval();
      return;
    }

    // Start polling if tab is visible
    if (document.visibilityState === "visible") {
      startInterval();
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Tab became visible — fire immediately and restart interval
        fireCallback();
        startInterval();
      } else {
        // Tab hidden — stop polling
        stopInterval();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopInterval();
      abortRef.current?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, startInterval, stopInterval, fireCallback]);
}
