import { useEffect, useRef } from "react";

const DRAG_THRESHOLD = 6;

interface PanelDragGrid {
  ref: React.RefObject<HTMLElement | null>;
  panelOrder: string[];
  onReorder: (order: string[]) => void;
}

/**
 * Multi-container drag-to-reorder panels with cross-grid transfer.
 * Uses DOM class manipulation during drag (no React re-renders) for smooth performance.
 * Supports mouse + touch.
 */
export function usePanelDrag(config: {
  grids: PanelDragGrid[];
  onTransfer?: (
    panelId: string,
    fromIdx: number,
    toIdx: number,
    newFromOrder: string[],
    newToOrder: string[]
  ) => void;
  onDragStateChange?: (dragging: boolean) => void;
}) {
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    const { grids } = configRef.current;
    const containers = grids.map((g) => g.ref.current).filter(Boolean) as HTMLElement[];
    if (containers.length === 0) return;

    let startY = 0;
    let active = false;
    let sourcePanel: HTMLElement | null = null;
    let sourceContainerIdx = -1;
    let lastIndicatorPanel: HTMLElement | null = null;
    let lastIndicatorSide: string | null = null;
    let lastTargetContainerIdx = -1;

    function getContainers(): HTMLElement[] {
      return configRef.current.grids
        .map((g) => g.ref.current)
        .filter(Boolean) as HTMLElement[];
    }

    function getPanelElements(container: HTMLElement): HTMLElement[] {
      return Array.from(container.querySelectorAll("[data-panel]"));
    }

    function findPanel(el: HTMLElement | null, container: HTMLElement): HTMLElement | null {
      while (el && el !== container) {
        if (el.hasAttribute("data-panel")) return el;
        el = el.parentElement;
      }
      return null;
    }

    function findContainerIdx(el: HTMLElement): number {
      const ctrs = getContainers();
      for (let i = 0; i < ctrs.length; i++) {
        if (ctrs[i].contains(el)) return i;
      }
      return -1;
    }

    function clearIndicators() {
      if (lastIndicatorPanel) {
        lastIndicatorPanel.classList.remove("panel-drop-above", "panel-drop-below");
        lastIndicatorPanel = null;
        lastIndicatorSide = null;
      }
      // Clear empty-container highlight
      const ctrs = getContainers();
      for (const c of ctrs) {
        c.classList.remove("panel-drop-target");
      }
    }

    function computeDropTarget(clientY: number): {
      containerIdx: number;
      panel: HTMLElement | null;
      above: boolean;
    } | null {
      const ctrs = getContainers();

      for (let ci = 0; ci < ctrs.length; ci++) {
        const rect = ctrs[ci].getBoundingClientRect();
        if (clientY < rect.top || clientY > rect.bottom) continue;

        const panels = getPanelElements(ctrs[ci]).filter((p) => p !== sourcePanel);
        if (panels.length === 0) {
          // Empty container — insert at position 0
          return { containerIdx: ci, panel: null, above: true };
        }

        for (let i = 0; i < panels.length; i++) {
          const pr = panels[i].getBoundingClientRect();
          const midY = pr.top + pr.height / 2;
          if (clientY < midY) {
            return { containerIdx: ci, panel: panels[i], above: true };
          }
        }
        // Below all — drop after last
        return { containerIdx: ci, panel: panels[panels.length - 1], above: false };
      }
      return null;
    }

    function beginDrag(clientY: number, target: HTMLElement) {
      if (target.closest("button, input, select, textarea, .panel-content")) return;
      if (!target.closest(".panel-header, .drag-handle")) return;

      const cIdx = findContainerIdx(target);
      if (cIdx === -1) return;
      const container = getContainers()[cIdx];
      sourcePanel = findPanel(target, container);
      if (!sourcePanel) return;

      sourceContainerIdx = cIdx;
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
        document.body.classList.add("panel-drag-active");
        configRef.current.onDragStateChange?.(true);
      }

      clearIndicators();
      const target = computeDropTarget(clientY);
      if (target) {
        lastTargetContainerIdx = target.containerIdx;
        if (target.panel) {
          const cls = target.above ? "panel-drop-above" : "panel-drop-below";
          target.panel.classList.add(cls);
          lastIndicatorPanel = target.panel;
          lastIndicatorSide = cls;
        } else {
          // Empty container highlight
          const ctrs = getContainers();
          ctrs[target.containerIdx].classList.add("panel-drop-target");
        }
      }
    }

    function endDrag() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.body.classList.remove("panel-drag-active");

      if (active && sourcePanel) {
        const sourceId = sourcePanel.getAttribute("data-panel")!;
        const cfg = configRef.current;

        if (lastTargetContainerIdx === sourceContainerIdx) {
          // Same-container reorder
          if (lastIndicatorPanel) {
            const targetId = lastIndicatorPanel.getAttribute("data-panel")!;
            const insertBefore = lastIndicatorSide === "panel-drop-above";
            const container = getContainers()[sourceContainerIdx];
            const visibleIds = getPanelElements(container).map((el) => el.getAttribute("data-panel")!);
            const filtered = visibleIds.filter((id) => id !== sourceId);
            let toIdx = filtered.indexOf(targetId);
            if (!insertBefore) toIdx++;
            filtered.splice(toIdx, 0, sourceId);

            // Reconstruct full order (preserve hidden panel positions)
            const fullOrder = [...cfg.grids[sourceContainerIdx].panelOrder];
            const visibleSet = new Set(filtered);
            const visibleSlots: number[] = [];
            for (let i = 0; i < fullOrder.length; i++) {
              if (visibleSet.has(fullOrder[i])) visibleSlots.push(i);
            }
            const newOrder = [...fullOrder];
            for (let i = 0; i < visibleSlots.length; i++) {
              newOrder[visibleSlots[i]] = filtered[i];
            }
            cfg.grids[sourceContainerIdx].onReorder(newOrder);
          }
        } else if (lastTargetContainerIdx >= 0) {
          // Cross-container transfer
          const fromGrid = cfg.grids[sourceContainerIdx];
          const toGrid = cfg.grids[lastTargetContainerIdx];

          // Remove from source
          const newFromOrder = fromGrid.panelOrder.filter((id) => id !== sourceId);

          // Insert into target
          const newToOrder = [...toGrid.panelOrder];
          if (lastIndicatorPanel) {
            const targetId = lastIndicatorPanel.getAttribute("data-panel")!;
            const insertBefore = lastIndicatorSide === "panel-drop-above";
            let toIdx = newToOrder.indexOf(targetId);
            if (toIdx === -1) toIdx = newToOrder.length;
            else if (!insertBefore) toIdx++;
            newToOrder.splice(toIdx, 0, sourceId);
          } else {
            // Empty container — insert at position 0
            newToOrder.push(sourceId);
          }

          cfg.onTransfer?.(
            sourceId,
            sourceContainerIdx,
            lastTargetContainerIdx,
            newFromOrder,
            newToOrder
          );
        }
      }

      // Cleanup
      if (sourcePanel) sourcePanel.classList.remove("panel-dragging");
      clearIndicators();
      sourcePanel = null;
      active = false;
      sourceContainerIdx = -1;
      lastTargetContainerIdx = -1;
      configRef.current.onDragStateChange?.(false);
    }

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
    function onTouchStart(e: TouchEvent) {
      beginDrag(e.touches[0].clientY, e.target as HTMLElement);
    }
    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      moveDrag(e.touches[0].clientY);
    }
    function onTouchEnd() {
      endDrag();
    }

    for (const container of containers) {
      container.addEventListener("mousedown", onMouseDown);
      container.addEventListener("touchstart", onTouchStart, { passive: true });
    }

    return () => {
      for (const container of containers) {
        container.removeEventListener("mousedown", onMouseDown);
        container.removeEventListener("touchstart", onTouchStart);
      }
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, []);
}
