import { useEffect, useRef } from "react";
import { rafSchedule } from "@/lib/rafSchedule";

const DRAG_THRESHOLD = 8;
const SAME_ROW_TOLERANCE_PX = 18;
const PANEL_DRAG_DEBUG = process.env.NEXT_PUBLIC_PANEL_DRAG_DEBUG === "1";

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

  useEffect(() => {
    configRef.current = config;
  });

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let active = false;
    let sourcePanel: HTMLElement | null = null;
    let sourceContainerIdx = -1;
    let lastIndicatorPanel: HTMLElement | null = null;
    let lastIndicatorSide: string | null = null;
    let lastTargetContainerIdx = -1;
    let ghost: HTMLElement | null = null;
    let latestClientX = 0;
    let latestClientY = 0;
    const scheduledDrag = rafSchedule(() => {
      moveGhost(latestClientX, latestClientY);
      applyIndicators(latestClientX, latestClientY);
    });
    let layoutSnapshot: Array<{
      container: HTMLElement;
      rect: DOMRect;
      panels: Array<{ el: HTMLElement; rect: DOMRect }>;
    }> = [];
    let projectedSameOrder: string[] | null = null;
    let projectedFromOrder: string[] | null = null;
    let projectedToOrder: string[] | null = null;

    function debugLog(label: string, payload: Record<string, unknown>) {
      if (!PANEL_DRAG_DEBUG) return;
      console.log(`[usePanelDrag] ${label}`, payload);
    }

    function getContainers(): HTMLElement[] {
      return configRef.current.grids
        .map((g) => g.ref.current)
        .filter(Boolean) as HTMLElement[];
    }

    function getPanelElements(container: HTMLElement): HTMLElement[] {
      return Array.from(container.querySelectorAll("[data-panel]"));
    }

    function snapshotLayout() {
      layoutSnapshot = getContainers().map((container) => ({
        container,
        rect: container.getBoundingClientRect(),
        panels: getPanelElements(container)
          .map((el) => ({
            el,
            rect: el.getBoundingClientRect(),
          }))
          .sort((a, b) => {
            const rowDelta = a.rect.top - b.rect.top;
            if (Math.abs(rowDelta) > SAME_ROW_TOLERANCE_PX) return rowDelta;
            return a.rect.left - b.rect.left;
          }),
      }));
      debugLog("snapshotLayout", {
        grids: layoutSnapshot.map((grid, idx) => ({
          idx,
          panels: grid.panels.map((panel) => ({
            id: panel.el.getAttribute("data-panel"),
            top: Math.round(panel.rect.top),
            left: Math.round(panel.rect.left),
            width: Math.round(panel.rect.width),
            height: Math.round(panel.rect.height),
          })),
        })),
      });
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

    function getSnapshotVisibleIds(containerIdx: number): string[] {
      return layoutSnapshot[containerIdx]?.panels
        .map((panel) => panel.el.getAttribute("data-panel"))
        .filter((id): id is string => Boolean(id)) ?? [];
    }

    function getSnapshotPanelRect(containerIdx: number, panelId: string): DOMRect | null {
      const match = layoutSnapshot[containerIdx]?.panels.find(
        (panel) => panel.el.getAttribute("data-panel") === panelId
      );
      return match?.rect ?? null;
    }

    function projectOrders(target: {
      containerIdx: number;
      panel: HTMLElement | null;
      before: boolean;
    } | null) {
      projectedSameOrder = null;
      projectedFromOrder = null;
      projectedToOrder = null;
      if (!sourcePanel || sourceContainerIdx < 0 || !target) return;

      const sourceId = sourcePanel.getAttribute("data-panel");
      if (!sourceId) return;

      const insertTargetId = target.panel?.getAttribute("data-panel") ?? null;

      if (target.containerIdx === sourceContainerIdx) {
        const base = getSnapshotVisibleIds(sourceContainerIdx).filter((id) => id !== sourceId);
        let insertIdx = base.length;
        if (insertTargetId) {
          const idx = base.indexOf(insertTargetId);
          insertIdx = idx === -1 ? base.length : idx + (target.before ? 0 : 1);
        }
        base.splice(insertIdx, 0, sourceId);
        projectedSameOrder = base;
        debugLog("projectOrders:sameGrid", {
          sourceId,
          sourceContainerIdx,
          targetContainerIdx: target.containerIdx,
          insertTargetId,
          before: target.before,
          projectedSameOrder: base,
        });
        return;
      }

      projectedFromOrder = getSnapshotVisibleIds(sourceContainerIdx).filter((id) => id !== sourceId);
      const targetOrder = getSnapshotVisibleIds(target.containerIdx).filter((id) => id !== sourceId);
      let insertIdx = targetOrder.length;
      if (insertTargetId) {
        const idx = targetOrder.indexOf(insertTargetId);
        insertIdx = idx === -1 ? targetOrder.length : idx + (target.before ? 0 : 1);
      }
      targetOrder.splice(insertIdx, 0, sourceId);
      projectedToOrder = targetOrder;
      debugLog("projectOrders:crossGrid", {
        sourceId,
        sourceContainerIdx,
        targetContainerIdx: target.containerIdx,
        insertTargetId,
        before: target.before,
        projectedFromOrder,
        projectedToOrder,
      });
    }

    function mergeVisibleOrder(fullOrder: string[], projectedVisibleOrder: string[]): string[] {
      const visibleSet = new Set(projectedVisibleOrder);
      const visibleSlots: number[] = [];
      for (let i = 0; i < fullOrder.length; i++) {
        if (visibleSet.has(fullOrder[i])) visibleSlots.push(i);
      }
      const newOrder = [...fullOrder];
      for (let i = 0; i < visibleSlots.length; i++) {
        newOrder[visibleSlots[i]] = projectedVisibleOrder[i];
      }
      return newOrder;
    }

    // --- Ghost preview ---
    function createGhost(panel: HTMLElement) {
      ghost = document.createElement("div");
      ghost.className = "panel-drag-ghost";
      ghost.style.left = "0";
      ghost.style.top = "0";

      // Extract just the panel title text
      const titleEl = panel.querySelector(".panel-title");
      const title = titleEl?.textContent || panel.getAttribute("data-panel") || "";
      ghost.textContent = title;

      document.body.appendChild(ghost);
    }

    function moveGhost(clientX: number, clientY: number) {
      if (!ghost) return;
      ghost.style.transform = `translate3d(${clientX + 14}px, ${clientY - 14}px, 0)`;
    }

    function removeGhost() {
      if (ghost) {
        ghost.remove();
        ghost = null;
      }
    }

    function computeDropTarget(clientX: number, clientY: number): {
      containerIdx: number;
      panel: HTMLElement | null;
      before: boolean;
    } | null {
      if (!sourcePanel) return null;
      let targetContainerIdx = -1;
      let targetPanel: HTMLElement | null = null;

      for (let i = 0; i < layoutSnapshot.length; i++) {
        const { rect, panels } = layoutSnapshot[i];
        if (
          clientX < rect.left ||
          clientX > rect.right ||
          clientY < rect.top ||
          clientY > rect.bottom
        ) {
          continue;
        }

        targetContainerIdx = i;
        for (const panel of panels) {
          if (panel.el === sourcePanel) continue;
          const panelRect = panel.rect;
          if (
            clientX >= panelRect.left &&
            clientX <= panelRect.right &&
            clientY >= panelRect.top &&
            clientY <= panelRect.bottom
          ) {
            targetPanel = panel.el;
            break;
          }
        }
        break;
      }

      if (targetContainerIdx === -1) return null;

      if (!targetPanel) {
        const result = { containerIdx: targetContainerIdx, panel: null, before: true };
        debugLog("computeDropTarget:containerOnly", {
          clientX: Math.round(clientX),
          clientY: Math.round(clientY),
          result,
        });
        return result;
      }

      const targetRect =
        layoutSnapshot[targetContainerIdx]?.panels.find((panel) => panel.el === targetPanel)?.rect
        ?? targetPanel.getBoundingClientRect();
      const sourceId = sourcePanel.getAttribute("data-panel");
      const sourceRect = sourceId ? getSnapshotPanelRect(sourceContainerIdx, sourceId) : null;
      const deltaX = clientX - startX;
      const deltaY = clientY - startY;
      const draggedCenterX = sourceRect
        ? sourceRect.left + deltaX + sourceRect.width / 2
        : clientX;
      const draggedCenterY = sourceRect
        ? sourceRect.top + deltaY + sourceRect.height / 2
        : clientY;
      const targetMidX = targetRect.left + targetRect.width / 2;
      const targetMidY = targetRect.top + targetRect.height / 2;
      const sameRow = sourceRect
        ? Math.abs(sourceRect.top - targetRect.top) <= SAME_ROW_TOLERANCE_PX
        : Math.abs(draggedCenterY - targetMidY) <= Math.max(targetRect.height * 0.35, SAME_ROW_TOLERANCE_PX);
      const before = sameRow ? draggedCenterX < targetMidX : draggedCenterY < targetMidY;
      const result = { containerIdx: targetContainerIdx, panel: targetPanel, before };
      debugLog("computeDropTarget:panel", {
        clientX: Math.round(clientX),
        clientY: Math.round(clientY),
        draggedCenterX: Math.round(draggedCenterX),
        draggedCenterY: Math.round(draggedCenterY),
        sourceId,
        sourceRect: sourceRect
          ? {
              top: Math.round(sourceRect.top),
              left: Math.round(sourceRect.left),
              width: Math.round(sourceRect.width),
              height: Math.round(sourceRect.height),
            }
          : null,
        targetId: targetPanel.getAttribute("data-panel"),
        targetRect: {
          top: Math.round(targetRect.top),
          left: Math.round(targetRect.left),
          width: Math.round(targetRect.width),
          height: Math.round(targetRect.height),
        },
        sameRow,
        before,
      });
      return result;
    }

    function applyIndicators(clientX: number, clientY: number) {
      const target = computeDropTarget(clientX, clientY);
      projectOrders(target);
      const nextPanel = target?.panel ?? null;
      const nextSide = target ? (target.before ? "panel-drop-above" : "panel-drop-below") : null;
      const nextContainerIdx = target?.containerIdx ?? -1;

      if (
        nextPanel === lastIndicatorPanel &&
        nextSide === lastIndicatorSide &&
        nextContainerIdx === lastTargetContainerIdx
      ) {
        return;
      }

      clearIndicators();
      lastTargetContainerIdx = nextContainerIdx;
      if (!target) return;
      if (target.panel) {
        const cls = target.before ? "panel-drop-above" : "panel-drop-below";
        target.panel.classList.add(cls);
        lastIndicatorPanel = target.panel;
        lastIndicatorSide = cls;
      } else {
        const ctrs = getContainers();
        ctrs[target.containerIdx]?.classList.add("panel-drop-target");
      }
    }

    function beginDrag(clientX: number, clientY: number, target: HTMLElement) {
      if (target.closest("button, input, select, textarea, .panel-content")) return;
      const handle = target.closest(".drag-handle") as HTMLElement | null;
      if (!handle) return;

      const cIdx = findContainerIdx(handle);
      if (cIdx === -1) return;
      const container = getContainers()[cIdx];
      sourcePanel = findPanel(handle, container);
      if (!sourcePanel) return;

      sourceContainerIdx = cIdx;
      startX = clientX;
      startY = clientY;
      active = false;
      debugLog("beginDrag", {
        sourceId: sourcePanel.getAttribute("data-panel"),
        sourceContainerIdx,
        startX: Math.round(clientX),
        startY: Math.round(clientY),
      });

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
        snapshotLayout();
        debugLog("activateDrag", {
          sourceId: sourcePanel.getAttribute("data-panel"),
          sourceContainerIdx,
        });
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        document.body.classList.add("panel-drag-active");
        configRef.current.onDragStateChange?.(true);
      }

      latestClientX = clientX;
      latestClientY = clientY;
      scheduledDrag();
    }

    function endDrag() {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      scheduledDrag.cancel();
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.body.classList.remove("panel-drag-active");

      if (active && sourcePanel) {
        const sourceId = sourcePanel.getAttribute("data-panel")!;
        const cfg = configRef.current;

        if (lastTargetContainerIdx === sourceContainerIdx) {
          // Same-container reorder
          if (projectedSameOrder) {
            const fullOrder = [...cfg.grids[sourceContainerIdx].panelOrder];
            const newOrder = mergeVisibleOrder(fullOrder, projectedSameOrder);
            debugLog("commit:sameGrid", {
              sourceId,
              sourceContainerIdx,
              fullOrder,
              projectedSameOrder,
              newOrder,
              indicatorPanel: lastIndicatorPanel?.getAttribute("data-panel"),
              indicatorSide: lastIndicatorSide,
            });
            cfg.grids[sourceContainerIdx].onReorder(newOrder);
          }
        } else if (lastTargetContainerIdx >= 0) {
          // Cross-container transfer
          const fromGrid = cfg.grids[sourceContainerIdx];
          const toGrid = cfg.grids[lastTargetContainerIdx];
          const newFromOrder = projectedFromOrder
            ? mergeVisibleOrder(fromGrid.panelOrder, projectedFromOrder)
            : fromGrid.panelOrder.filter((id) => id !== sourceId);
          const newToOrder = projectedToOrder
            ? mergeVisibleOrder(toGrid.panelOrder, projectedToOrder)
            : [...toGrid.panelOrder, sourceId];
          debugLog("commit:crossGrid", {
            sourceId,
            sourceContainerIdx,
            targetContainerIdx: lastTargetContainerIdx,
            newFromOrder,
            newToOrder,
            projectedFromOrder,
            projectedToOrder,
            indicatorPanel: lastIndicatorPanel?.getAttribute("data-panel"),
            indicatorSide: lastIndicatorSide,
          });

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
      layoutSnapshot = [];
      projectedSameOrder = null;
      projectedFromOrder = null;
      projectedToOrder = null;
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

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("touchmove", onTouchMovePrevent, { passive: false });

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("touchmove", onTouchMovePrevent);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      scheduledDrag.cancel();
      removeGhost();
    };
  }, []);
}
