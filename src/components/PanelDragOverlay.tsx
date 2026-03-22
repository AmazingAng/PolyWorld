"use client";

import type { CSSProperties } from "react";
import type { PanelDragOverlayData } from "@/hooks/usePanelDrag";

export default function PanelDragOverlay({ title, metaText, width, height }: PanelDragOverlayData) {
  const style: CSSProperties = {
    width,
    height,
  };

  return (
    <div className="panel-drag-ghost" style={style}>
      <div className="panel-drag-ghost__header">
        <span className="panel-drag-ghost__grip" aria-hidden="true">
          <span></span><span></span><span></span><span></span><span></span><span></span>
        </span>
        <span className="panel-drag-ghost__title">{title}</span>
        {metaText ? <span className="panel-drag-ghost__meta">{metaText}</span> : null}
      </div>
      <div className="panel-drag-ghost__body" aria-hidden="true">
        <span className="panel-drag-ghost__line w-90"></span>
        <span className="panel-drag-ghost__line w-60"></span>
        <span className="panel-drag-ghost__line w-75"></span>
        <span className="panel-drag-ghost__line w-45"></span>
      </div>
    </div>
  );
}
