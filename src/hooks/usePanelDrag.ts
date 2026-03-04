import { useEffect, useRef } from "react";

const DRAG_THRESHOLD = 8;

export function usePanelDrag(
  containerRef: React.RefObject<HTMLElement | null>,
  onReorder: (order: string[]) => void
) {
  const draggingEl = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let startX = 0;
    let startY = 0;
    let isDragging = false;
    let sourcePanel: HTMLElement | null = null;

    function findPanel(el: HTMLElement | null): HTMLElement | null {
      while (el && el !== container) {
        if (el.hasAttribute("data-panel")) return el;
        el = el.parentElement;
      }
      return null;
    }

    function onMouseDown(e: MouseEvent) {
      // Only left click
      if (e.button !== 0) return;

      const target = e.target as HTMLElement;

      // Ignore clicks on buttons, inputs, or panel-content
      if (target.closest("button, input, select, textarea, .panel-content")) return;

      // Must originate from a panel-header
      if (!target.closest(".panel-header")) return;

      sourcePanel = findPanel(target);
      if (!sourcePanel) return;

      startX = e.clientX;
      startY = e.clientY;
      isDragging = false;

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    }

    function onMouseMove(e: MouseEvent) {
      if (!sourcePanel) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      // 8px threshold before starting drag
      if (!isDragging && Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;

      if (!isDragging) {
        isDragging = true;
        sourcePanel.classList.add("dragging");
        draggingEl.current = sourcePanel;
      }

      // Find target panel under cursor
      const elUnder = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (!elUnder) return;

      const targetPanel = findPanel(elUnder);
      if (!targetPanel || targetPanel === sourcePanel) return;

      // Swap DOM positions
      const sourceRect = sourcePanel.getBoundingClientRect();
      const targetRect = targetPanel.getBoundingClientRect();

      if (sourceRect.top < targetRect.top || sourceRect.left < targetRect.left) {
        targetPanel.after(sourcePanel);
      } else {
        targetPanel.before(sourcePanel);
      }
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);

      if (isDragging && sourcePanel) {
        sourcePanel.classList.remove("dragging");
        draggingEl.current = null;

        // Read new DOM order
        const panels = container!.querySelectorAll("[data-panel]");
        const newOrder: string[] = [];
        panels.forEach((el) => {
          const id = el.getAttribute("data-panel");
          if (id) newOrder.push(id);
        });
        onReorder(newOrder);
      }

      sourcePanel = null;
      isDragging = false;
    }

    container.addEventListener("mousedown", onMouseDown);
    return () => {
      container.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [containerRef, onReorder]);
}
