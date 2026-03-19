"use client";

import { useCallback, useRef, useEffect, useMemo } from "react";
import { rafSchedule } from "@/lib/rafSchedule";

interface ResizeHandleProps {
  direction: "horizontal" | "vertical";
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
}

export default function ResizeHandle({ direction, onResize, onResizeEnd }: ResizeHandleProps) {
  const dragging = useRef(false);
  const lastPos = useRef(0);
  const onResizeRef = useRef(onResize);
  const onResizeEndRef = useRef(onResizeEnd);

  useEffect(() => {
    onResizeRef.current = onResize;
    onResizeEndRef.current = onResizeEnd;
  }, [onResize, onResizeEnd]);

  // eslint-disable-next-line react-hooks/refs
  const scheduledResize = useMemo(() => rafSchedule((delta: number) => {
    onResizeRef.current(delta);
  }), []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastPos.current = direction === "vertical" ? e.clientX : e.clientY;
    document.body.style.cursor = direction === "vertical" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    // Block pointer events on iframes/canvas during drag
    document.body.classList.add("resize-active");
  }, [direction]);

  useEffect(() => {
    const isVertical = direction === "vertical";

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const pos = isVertical ? e.clientX : e.clientY;
      const delta = pos - lastPos.current;
      if (delta !== 0) {
        lastPos.current = pos;
        scheduledResize(delta);
      }
    };

    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      scheduledResize.cancel();
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.classList.remove("resize-active");
      onResizeEndRef.current?.();
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      scheduledResize.cancel();
    };
  }, [direction, scheduledResize]);

  return (
    <div
      className={`resize-handle resize-handle-${direction}`}
      onMouseDown={onMouseDown}
    >
      <div className="resize-handle-bar" />
    </div>
  );
}
