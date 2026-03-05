import { useEffect, useRef } from "react";

const DRAG_THRESHOLD = 6;

/**
 * Drag-to-reorder panels within a container.
 * Uses DOM class manipulation during drag (no React re-renders) for smooth performance.
 * Supports mouse + touch. Computes new order on drop.
 */
export function usePanelDrag(
  containerRef: React.RefObject<HTMLElement | null>,
  panelOrder: string[],
  onReorder: (order: string[]) => void
) {
  const orderRef = useRef(panelOrder);
  orderRef.current = panelOrder;
  const reorderRef = useRef(onReorder);
  reorderRef.current = onReorder;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let startY = 0;
    let active = false;
    let sourcePanel: HTMLElement | null = null;
    let lastIndicatorPanel: HTMLElement | null = null;
    let lastIndicatorSide: string | null = null;

    function getPanelElements(): HTMLElement[] {
      return Array.from(container!.querySelectorAll("[data-panel]"));
    }

    function findPanel(el: HTMLElement | null): HTMLElement | null {
      while (el && el !== container) {
        if (el.hasAttribute("data-panel")) return el;
        el = el.parentElement;
      }
      return null;
    }

    function clearIndicators() {
      if (lastIndicatorPanel) {
        lastIndicatorPanel.classList.remove("panel-drop-above", "panel-drop-below");
        lastIndicatorPanel = null;
        lastIndicatorSide = null;
      }
    }

    function computeDropTarget(clientY: number): { panel: HTMLElement; above: boolean } | null {
      const panels = getPanelElements().filter((p) => p !== sourcePanel);
      if (panels.length === 0) return null;

      for (let i = 0; i < panels.length; i++) {
        const rect = panels[i].getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (clientY < midY) {
          return { panel: panels[i], above: true };
        }
      }
      // Below all — drop after last
      return { panel: panels[panels.length - 1], above: false };
    }

    function beginDrag(clientY: number, target: HTMLElement) {
      // Ignore clicks on interactive elements or panel content
      if (target.closest("button, input, select, textarea, .panel-content")) return;
      // Must start from panel header or drag handle
      if (!target.closest(".panel-header, .drag-handle")) return;

      sourcePanel = findPanel(target);
      if (!sourcePanel) return;

      startY = clientY;
      active = false;

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.addEventListener("touchmove", onTouchMove, { passive: false });
      document.addEventListener("touchend", onTouchEnd);
    }

    function moveDrag(clientY: number) {
      if (!sourcePanel) return;

      if (!active) {
        if (Math.abs(clientY - startY) < DRAG_THRESHOLD) return;
        active = true;
        sourcePanel.classList.add("panel-dragging");
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
      }

      // Compute drop target
      clearIndicators();
      const target = computeDropTarget(clientY);
      if (target) {
        const cls = target.above ? "panel-drop-above" : "panel-drop-below";
        target.panel.classList.add(cls);
        lastIndicatorPanel = target.panel;
        lastIndicatorSide = cls;
      }
    }

    function endDrag() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";

      if (active && sourcePanel && lastIndicatorPanel) {
        const sourceId = sourcePanel.getAttribute("data-panel")!;
        const targetId = lastIndicatorPanel.getAttribute("data-panel")!;
        const insertBefore = lastIndicatorSide === "panel-drop-above";

        // Build new visible order
        const visibleIds = getPanelElements().map((el) => el.getAttribute("data-panel")!);
        const filtered = visibleIds.filter((id) => id !== sourceId);
        let toIdx = filtered.indexOf(targetId);
        if (!insertBefore) toIdx++;
        filtered.splice(toIdx, 0, sourceId);

        // Reconstruct full order (preserve hidden panel positions)
        const fullOrder = [...orderRef.current];
        const visibleSet = new Set(filtered);
        const visibleSlots: number[] = [];
        for (let i = 0; i < fullOrder.length; i++) {
          if (visibleSet.has(fullOrder[i])) visibleSlots.push(i);
        }
        const newOrder = [...fullOrder];
        for (let i = 0; i < visibleSlots.length; i++) {
          newOrder[visibleSlots[i]] = filtered[i];
        }

        reorderRef.current(newOrder);
      }

      // Cleanup classes
      if (sourcePanel) sourcePanel.classList.remove("panel-dragging");
      clearIndicators();
      sourcePanel = null;
      active = false;
    }

    // Mouse events
    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      beginDrag(e.clientY, e.target as HTMLElement);
    }
    function onMouseMove(e: MouseEvent) {
      moveDrag(e.clientY);
    }
    function onMouseUp() {
      endDrag();
    }

    // Touch events
    function onTouchStart(e: TouchEvent) {
      beginDrag(e.touches[0].clientY, e.target as HTMLElement);
    }
    function onTouchMove(e: TouchEvent) {
      e.preventDefault(); // prevent scroll during drag
      moveDrag(e.touches[0].clientY);
    }
    function onTouchEnd() {
      endDrag();
    }

    container.addEventListener("mousedown", onMouseDown);
    container.addEventListener("touchstart", onTouchStart, { passive: true });

    return () => {
      container.removeEventListener("mousedown", onMouseDown);
      container.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [containerRef]);
}
