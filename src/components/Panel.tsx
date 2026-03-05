"use client";

import React, { useState, useRef, useEffect } from "react";
import { useColResize } from "@/hooks/useColResize";

interface PanelProps {
  title: string;
  count?: number | string;
  badge?: React.ReactNode;
  wide?: boolean;
  className?: string;
  children: React.ReactNode;
  headerRight?: React.ReactNode;
  panelId?: string;
  colSpan?: number;
  onColSpanChange?: (span: number) => void;
  onColSpanReset?: () => void;
}

export default function Panel({
  title,
  count,
  badge,
  wide,
  className,
  children,
  headerRight,
  panelId,
  colSpan,
  onColSpanChange,
  onColSpanReset,
}: PanelProps) {
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const { onMouseDown } = useColResize(colSpan ?? 1, onColSpanChange);

  // Escape key to close
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [expanded]);

  const spanStyle: React.CSSProperties | undefined =
    colSpan === 2 ? { gridColumn: "1 / -1" } : colSpan === 1 ? { gridColumn: "span 1" } : undefined;

  return (
    <div
      ref={panelRef}
      data-panel={panelId}
      className={`panel${wide ? " panel-wide" : ""}${expanded ? " panel-expanded" : ""}${className ? ` ${className}` : ""}`}
      style={spanStyle}
    >
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <span className="drag-handle" title="Drag to reorder">
            <svg width="6" height="10" viewBox="0 0 6 10" fill="currentColor">
              <circle cx="1" cy="1" r="1" /><circle cx="5" cy="1" r="1" />
              <circle cx="1" cy="5" r="1" /><circle cx="5" cy="5" r="1" />
              <circle cx="1" cy="9" r="1" /><circle cx="5" cy="9" r="1" />
            </svg>
          </span>
          <span className="panel-title">{title}</span>
          {count !== undefined && (
            <span className="panel-count">{count}</span>
          )}
          {badge}
        </div>
        <div className="flex items-center gap-1.5">
          {headerRight}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="panel-expand-btn"
            title={expanded ? "Exit fullscreen" : "Fullscreen"}
          >
            {expanded ? (
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polyline points="4 14 4 10 0 10" />
                <polyline points="12 2 12 6 16 6" />
                <line x1="0" y1="16" x2="6" y2="10" />
                <line x1="16" y1="0" x2="10" y2="6" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polyline points="10 2 14 2 14 6" />
                <polyline points="6 14 2 14 2 10" />
                <line x1="14" y1="2" x2="9" y2="7" />
                <line x1="2" y1="14" x2="7" y2="9" />
              </svg>
            )}
          </button>
        </div>
      </div>
      <div className="panel-content">{children}</div>

      {/* Right-edge resize handle */}
      {onColSpanChange && !expanded && (
        <div
          className="panel-col-resize-handle"
          onMouseDown={onMouseDown}
          onDoubleClick={onColSpanReset}
          title="Drag to resize · Double-click to reset"
        >
          <div className="panel-col-resize-bar" />
        </div>
      )}
    </div>
  );
}
