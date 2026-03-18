"use client";

import { useState, useCallback, useEffect, useRef } from "react";

/**
 * Unified hook for managing per-panel span state (column or row spans),
 * persisted to localStorage.
 */
export function usePanelSpans(storageKey: string, defaultSpan: number) {
  const [spans, setSpans] = useState<Record<string, number>>({});
  const hydrated = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        hydrated.current = true;
        return;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        setSpans(parsed as Record<string, number>);
      }
    } catch {
      // Ignore malformed persisted layout data.
    } finally {
      hydrated.current = true;
    }
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated.current) {
      return;
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(spans));
    } catch {}
  }, [spans, storageKey]);

  const getSpan = useCallback(
    (panelId: string, fallback?: number) => spans[panelId] ?? (fallback ?? defaultSpan),
    [spans, defaultSpan]
  );

  const setSpan = useCallback((panelId: string, span: number) => {
    setSpans((prev) => ({ ...prev, [panelId]: span }));
  }, []);

  const resetSpan = useCallback((panelId: string) => {
    setSpans((prev) => {
      const next = { ...prev };
      delete next[panelId];
      return next;
    });
  }, []);

  return { getSpan, setSpan, resetSpan };
}
