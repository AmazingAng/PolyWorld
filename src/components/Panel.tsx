"use client";

import React, { useState, useRef, useEffect } from "react";

interface PanelProps {
  title: string;
  count?: number | string;
  badge?: React.ReactNode;
  wide?: boolean;
  className?: string;
  children: React.ReactNode;
  headerRight?: React.ReactNode;
  panelId?: string;
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
}: PanelProps) {
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape key to close
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [expanded]);

  return (
    <div
      ref={panelRef}
      data-panel={panelId}
      className={`panel${wide ? " panel-wide" : ""}${expanded ? " panel-expanded" : ""}${className ? ` ${className}` : ""}`}
    >
      <div className="panel-header">
        <div className="flex items-center gap-2">
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
    </div>
  );
}
