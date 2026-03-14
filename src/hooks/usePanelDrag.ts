import { useEffect, useRef } from "react";

const DRAG_THRESHOLD = 8;

interface PanelDragGrid {
  ref: React.RefObject<HTMLElement | null>;
  panelOrder: string[];
  onReorder: (order: string[]) => void;
}

/**
 * Multi-container drag-to-reorder panels with cross-grid transfer.
 * Uses elementFromPoint + ghost preview for accurate hit detection.
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

    let startX = 0;
    let startY = 0;
    let active = false;
    let sourcePanel: HTMLElement | null = null;
    let sourceContainerIdx = -1;
    let lastIndicatorPanel: HTMLElement | null = null;
    let lastIndicatorSide: string | null = null;
    let lastTargetContainerIdx = -1;
    let ghost: HTMLElement | null = null;

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
      const ctrs = getContainers();
      for (const c of ctrs) {
        c.classList.remove("panel-drop-target");
      }
    }

    // --- Ghost preview ---
    function createGhost(panel: HTMLElement) {
      ghost = document.createElement("div");
      ghost.className = "panel-drag-ghost";

      // Extract just the panel title text
      const titleEl = panel.querySelector(".panel-title");
      const title = titleEl?.textContent || panel.getAttribute("data-panel") || "";
      ghost.textContent = title;

      document.body.appendChild(ghost);
    }

    function moveGhost(clientX: number, clientY: number) {
      if (!ghost) return;
      ghost.style.left = clientX + 14 + "px";
      ghost.style.top = clientY - 14 + "px";
    }

    function removeGhost() {
      if (ghost) {
        ghost.remove();
        ghost = null;
      }
    }

    // --- Drop target via elementFromPoint ---
    function computeDropTarget(clientX: number, clientY: number): {
      containerIdx: number;
      panel: HTMLElement | null;
      above: boolean;
    } | null {
      if (!sourcePanel) return null;

      // Temporarily hide source + ghost so elementFromPoint sees through
      const prevSrc = sourcePanel.style.visibility;
      sourcePanel.style.visibility = "hidden";
      if (ghost) ghost.style.display = "none";

      const el = document.elementFromPoint(clientX, clientY);

      sourcePanel.style.visibility = prevSrc;
      if (ghost) ghost.style.display = "";

      if (!el) return null;

      const ctrs = getContainers();
      let targetPanel: HTMLElement | null = null;
      let targetContainerIdx = -1;

      // Check if cursor is over a panel
      const panelEl = el.closest("[data-panel]") as HTMLElement | null;
      if (panelEl && panelEl !== sourcePanel) {
        targetPanel = panelEl;
        for (let i = 0; i < ctrs.length; i++) {
          if (ctrs[i].contains(panelEl)) {
            targetContainerIdx = i;
            break;
          }
        }
      }

      // Check if cursor is over a container (but not on a panel)
      if (targetContainerIdx === -1) {
        for (let i = 0; i < ctrs.length; i++) {
          const rect = ctrs[i].getBoundingClientRect();
          if (
            clientX >= rect.left && clientX <= rect.right &&
            clientY >= rect.top && clientY <= rect.bottom
          ) {
            targetContainerIdx = i;
            break;
          }
        }
      }

      if (targetContainerIdx === -1) return null;

      if (!targetPanel) {
        return { containerIdx: targetContainerIdx, panel: null, above: true };
      }

      // Row-aware midpoint: same row → horizontal, different row → vertical
      const targetRect = targetPanel.getBoundingClientRect();
      const midY = targetRect.top + targetRect.height / 2;
      const above = clientY < midY;

      return { containerIdx: targetContainerIdx, panel: targetPanel, above };
    }

    function applyIndicators(clientX: number, clientY: number) {
      clearIndicators();
      const target = computeDropTarget(clientX, clientY);
      if (target) {
        lastTargetContainerIdx = target.containerIdx;
        if (target.panel) {
          const cls = target.above ? "panel-drop-above" : "panel-drop-below";
          target.panel.classList.add(cls);
          lastIndicatorPanel = target.panel;
          lastIndicatorSide = cls;
        } else {
          const ctrs = getContainers();
          ctrs[target.containerIdx].classList.add("panel-drop-target");
        }
      }
    }

    function beginDrag(clientX: number, clientY: number, target: HTMLElement) {
      if (target.closest("button, input, select, textarea, .panel-content")) return;
      if (!target.closest(".panel-header, .drag-handle")) return;

      const cIdx = findContainerIdx(target);
      if (cIdx === -1) return;
      const container = getContainers()[cIdx];
      sourcePanel = findPanel(target, container);
      if (!sourcePanel) return;

      sourceContainerIdx = cIdx;
      startX = clientX;
      startY = clientY;
      active = false;

      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
    }

    function moveDrag(clientX: number, clientY: number) {
      if (!sourcePanel) return;

      if (!active) {
        const dx = clientX - startX;
        const dy = clientY - startY;
        if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
        active = true;
        sourcePanel.classList.add("panel-dragging");
        createGhost(sourcePanel);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        document.body.classList.add("panel-drag-active");
        configRef.current.onDragStateChange?.(true);
      }

      // Ghost follows cursor directly (no rAF for responsiveness)
      moveGhost(clientX, clientY);
      // Indicators computed synchronously
      applyIndicators(clientX, clientY);
    }

    function endDrag() {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
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

          const newFromOrder = fromGrid.panelOrder.filter((id) => id !== sourceId);

          const newToOrder = [...toGrid.panelOrder];
          if (lastIndicatorPanel) {
            const targetId = lastIndicatorPanel.getAttribute("data-panel")!;
            const insertBefore = lastIndicatorSide === "panel-drop-above";
            let toIdx = newToOrder.indexOf(targetId);
            if (toIdx === -1) toIdx = newToOrder.length;
            else if (!insertBefore) toIdx++;
            newToOrder.splice(toIdx, 0, sourceId);
          } else {
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
      removeGhost();
      sourcePanel = null;
      active = false;
      sourceContainerIdx = -1;
      lastTargetContainerIdx = -1;
      configRef.current.onDragStateChange?.(false);
    }

    // Unified Pointer Events for mouse + touch
    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return;
      beginDrag(e.clientX, e.clientY, e.target as HTMLElement);
    }
    function onPointerMove(e: PointerEvent) {
      moveDrag(e.clientX, e.clientY);
    }
    function onPointerUp() {
      endDrag();
    }
    // Prevent default touch scrolling while dragging
    function onTouchMovePrevent(e: TouchEvent) {
      if (active) e.preventDefault();
    }

    for (const container of containers) {
      container.addEventListener("pointerdown", onPointerDown);
      container.addEventListener("touchmove", onTouchMovePrevent, { passive: false });
    }

    return () => {
      for (const container of containers) {
        container.removeEventListener("pointerdown", onPointerDown);
        container.removeEventListener("touchmove", onTouchMovePrevent);
      }
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      removeGhost();
    };
  }, []);
}
