import { useEffect, useRef, useCallback } from "react";

/**
 * Visibility-aware polling hook.
 * - Runs `callback` on an interval
 * - Pauses when the tab is hidden (document.visibilityState === "hidden")
 * - Resumes immediately when the tab becomes visible again (fires callback once)
 *
 * @param callback  Async or sync function to call on each tick
 * @param intervalMs  Polling interval in milliseconds
 * @param enabled  Whether polling is active (defaults to true)
 */
export function useVisibilityPolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  enabled = true,
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startInterval = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => callbackRef.current(), intervalMs);
  }, [intervalMs]);

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
        callbackRef.current();
        startInterval();
      } else {
        // Tab hidden — stop polling
        stopInterval();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopInterval();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, startInterval, stopInterval]);
}
