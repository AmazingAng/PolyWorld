"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * Generic localStorage hook with version control and error handling.
 * - SSR-safe: always returns defaultValue on server and first client render
 * - Hydrates from localStorage in a useEffect (avoids hydration mismatch)
 * - Writes on value change
 * - Version mismatch → discard and use default
 * - Graceful fallback for storage full / private mode
 */
export function useLocalStorage<T extends { version: number }>(
  key: string,
  defaultValue: T
): [T, (value: T | ((prev: T) => T)) => void, boolean] {
  // Always start with default for SSR consistency
  const [state, setState] = useState<T>(defaultValue);
  const [isHydrated, setIsHydrated] = useState(false);

  // Hydrate from localStorage after mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as T;
        if (parsed.version === defaultValue.version) {
          setState(parsed);
        }
      }
    } catch {
      // corrupted or unavailable
    }
    setIsHydrated(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Persist changes — only after hydration is complete
  useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // storage full or unavailable — silently fail
    }
  }, [key, state, isHydrated]);

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next = typeof value === "function" ? (value as (prev: T) => T)(prev) : value;
        return next;
      });
    },
    []
  );

  return [state, setValue, isHydrated];
}
