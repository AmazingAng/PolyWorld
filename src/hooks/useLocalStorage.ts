"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Generic localStorage hook with version control and error handling.
 * - Lazy initialization from localStorage
 * - Writes on value change
 * - Version mismatch → discard and use default
 * - Graceful fallback for storage full / private mode
 */
export function useLocalStorage<T extends { version: number }>(
  key: string,
  defaultValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as T;
        if (parsed.version === defaultValue.version) {
          return parsed;
        }
      }
    } catch {
      // corrupted or unavailable
    }
    return defaultValue;
  });

  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // storage full or unavailable — silently fail
    }
  }, [key, state]);

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next = typeof value === "function" ? (value as (prev: T) => T)(prev) : value;
        return next;
      });
    },
    []
  );

  return [state, setValue];
}
