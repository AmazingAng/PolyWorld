"use client";

import { useState, useCallback, useEffect, useRef } from "react";

const STORAGE_KEY = "pw:panel-row-spans";

/**
 * Manages per-panel row span state, persisted to localStorage.
 * Values are in half-row units: 1 = 50%, 2 = 100% (default), 3 = 150%, 4 = 200%.
 */
export function usePanelRowSpans() {
  const [rowSpans, setRowSpans] = useState<Record<string, number>>({});
  const hydrated = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          setRowSpans(parsed);
        }
      }
    } catch {}
    hydrated.current = true;
  }, []);

  const skipNext = useRef(true);
  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    if (!hydrated.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rowSpans));
    } catch {}
  }, [rowSpans]);

  const getRowSpan = useCallback(
    (panelId: string, defaultSpan = 2) => rowSpans[panelId] ?? defaultSpan,
    [rowSpans]
  );

  const setRowSpan = useCallback((panelId: string, span: number) => {
    setRowSpans((prev) => ({ ...prev, [panelId]: span }));
  }, []);

  const resetRowSpan = useCallback((panelId: string) => {
    setRowSpans((prev) => {
      const next = { ...prev };
      delete next[panelId];
      return next;
    });
  }, []);

  return { getRowSpan, setRowSpan, resetRowSpan };
}
