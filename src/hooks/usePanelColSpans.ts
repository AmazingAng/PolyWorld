"use client";

import { useState, useCallback, useEffect, useRef } from "react";

const STORAGE_KEY = "pw:panel-col-spans";

/**
 * Manages per-panel column span state, persisted to localStorage.
 * Each panel can span 1 or 2 columns in the panels grid.
 */
export function usePanelColSpans() {
  const [colSpans, setColSpans] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {};
  });

  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(colSpans));
    } catch {}
  }, [colSpans]);

  const getColSpan = useCallback(
    (panelId: string, defaultSpan = 1) => colSpans[panelId] ?? defaultSpan,
    [colSpans]
  );

  const setColSpan = useCallback((panelId: string, span: number) => {
    setColSpans((prev) => ({ ...prev, [panelId]: span }));
  }, []);

  const resetColSpan = useCallback((panelId: string) => {
    setColSpans((prev) => {
      const next = { ...prev };
      delete next[panelId];
      return next;
    });
  }, []);

  return { colSpans, getColSpan, setColSpan, resetColSpan };
}
