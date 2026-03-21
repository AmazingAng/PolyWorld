import { useEffect, useRef } from "react";
import { rafSchedule } from "@/lib/rafSchedule";

const DRAG_THRESHOLD = 8;
const DRAG_THRESHOLD_SQ = DRAG_THRESHOLD * DRAG_THRESHOLD;
const CONTAINER_EDGE_TOLERANCE_PX = 20;
const AUTO_SCROLL_EDGE_PX = 56;
const AUTO_SCROLL_MAX_STEP_PX = 22;
const AUTO_SCROLL_OUTSIDE_TOLERANCE_PX = 28;
const LAYOUT_ANIMATION_MS = 180;
const LAYOUT_ANIMATION_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const PANEL_DRAG_DEBUG = process.env.NEXT_PUBLIC_PANEL_DRAG_DEBUG === "1" ||
  (typeof window !== "undefined" && process.env.NODE_ENV === "development");
const PANEL_DRAG_PERF = typeof window !== "undefined" &&
  (process.env.NEXT_PUBLIC_PANEL_DRAG_PERF === "1" || PANEL_DRAG_DEBUG ||
   process.env.NODE_ENV === "development");

interface SnapshotPanel {
  el: HTMLElement;
  id: string;
  rect: DOMRect;
  colSpan: number;
  rowSpan: number;
  index: number;
}

interface LayoutItem {
  el: HTMLElement;
  id: string;
  colSpan: number;
  rowSpan: number;
}

interface DropTarget {
  containerIdx: number;
  insertIndex: number;
  previewRect: DOMRect;
}

interface ContainerSnapshot {
  container: HTMLElement;
  rect: DOMRect;
  panels: SnapshotPanel[];
  items: LayoutItem[];
  previewRects: DOMRect[];
  cellWidth: number;
  rowHeight: number;
  colGap: number;
  rowGap: number;
  paddingLeft: number;
  paddingTop: number;
  scrollLeft: number;
  scrollTop: number;
}

interface PanelDragGrid {
  ref: React.RefObject<HTMLElement | null>;
  panelOrder: string[];
  onReorder: (order: string[]) => void;
  maxCols: number;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function arraysEqual(a: string[], b: string[]) {
  return a.length === b.length && a.every((item, idx) => item === b[idx]);
}

/**
 * Multi-container drag-to-reorder panels with cross-grid transfer.
 * Uses a live placeholder for slot preview and a lightweight overlay card
 * that tracks the pointer without forcing React re-renders mid-drag.
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
    let lastTargetContainerIdx = -1;
    let lastTargetKey = "none";
    let sourceRect: DOMRect | null = null;
    let sourceColSpan = 1;
    let sourceRowSpan = 2;
    let ghost: HTMLElement | null = null;
    let ghostOffsetX = 18;
    let ghostOffsetY = 14;
    let placeholder: HTMLDivElement | null = null;
    let latestClientX = 0;
    let latestClientY = 0;
    const layoutAnimationTimeouts = new Map<HTMLElement, number>();
    const stableLayoutRects = new Map<HTMLElement, DOMRect>();
    let autoScrollFrameId = 0;
    let layoutSnapshot: ContainerSnapshot[] = [];
    let snapshotStale = false;

    const scheduledDrag = rafSchedule(() => {
      const _t0 = PANEL_DRAG_PERF ? performance.now() : 0;
      if (snapshotStale) {
        snapshotStale = false;
        snapshotLayout();
      }
      moveGhost(latestClientX, latestClientY);
      updateDropTarget(latestClientX, latestClientY);
      if (PANEL_DRAG_PERF) {
        perfFrameCount++;
        perfFrameTotalMs += performance.now() - _t0;
        perfReport();
      }
    });

    function debugLog(label: string, payload: Record<string, unknown>) {
      if (!PANEL_DRAG_DEBUG) return;
      console.log(`[usePanelDrag] ${label}`, payload);
    }

    // ─── Perf instrumentation ───
    let perfFrameCount = 0;
    let perfFrameTotalMs = 0;
    let perfSnapshotTotalMs = 0;
    let perfSnapshotCount = 0;
    let perfHitTestMs = 0;
    let perfComputeDropMs = 0;
    let perfMovePlaceholderMs = 0;
    let perfLastReport = 0;

    function perfReport() {
      if (!PANEL_DRAG_PERF || perfFrameCount === 0) return;
      const now = performance.now();
      if (now - perfLastReport < 1000) return; // report every 1s
      perfLastReport = now;
      const avgFrame = perfFrameTotalMs / perfFrameCount;
      console.log(
        `[drag-perf] frames=${perfFrameCount} avgFrame=${avgFrame.toFixed(2)}ms | ` +
        `snapshot: ${perfSnapshotCount}x total=${perfSnapshotTotalMs.toFixed(1)}ms avg=${perfSnapshotCount ? (perfSnapshotTotalMs / perfSnapshotCount).toFixed(2) : 0}ms | ` +
        `hitTest=${perfHitTestMs.toFixed(1)}ms | ` +
        `computeDrop=${perfComputeDropMs.toFixed(1)}ms | ` +
        `movePlaceholder=${perfMovePlaceholderMs.toFixed(1)}ms`
      );
      // reset accumulators
      perfFrameCount = 0;
      perfFrameTotalMs = 0;
      perfSnapshotTotalMs = 0;
      perfSnapshotCount = 0;
      perfHitTestMs = 0;
      perfComputeDropMs = 0;
      perfMovePlaceholderMs = 0;
    }

    function perfReset() {
      perfFrameCount = 0;
      perfFrameTotalMs = 0;
      perfSnapshotTotalMs = 0;
      perfSnapshotCount = 0;
      perfHitTestMs = 0;
      perfComputeDropMs = 0;
      perfMovePlaceholderMs = 0;
      perfLastReport = 0;
    }

    function getContainers(): HTMLElement[] {
      return configRef.current.grids
        .map((grid) => grid.ref.current)
        .filter(Boolean) as HTMLElement[];
    }

    function getPanelElements(container: HTMLElement) {
      return Array.from(container.children).filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement &&
          child !== sourcePanel &&
          child.hasAttribute("data-panel")
      );
    }

    function parseGridSpan(value: string, fallback: number) {
      const match = value.match(/span\s+(\d+)/i);
      if (!match) return fallback;
      const parsed = Number.parseInt(match[1] ?? "", 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }

    function getPanelLayoutItem(el: HTMLElement): LayoutItem | null {
      const id = el.getAttribute("data-panel");
      if (!id) return null;
      return {
        el,
        id,
        colSpan: parseGridSpan(el.style.gridColumn, 1),
        rowSpan: parseGridSpan(el.style.gridRow, 2),
      };
    }

    function parsePx(value: string) {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    function buildContainerMetrics(container: HTMLElement, maxCols: number) {
      const rect = container.getBoundingClientRect();
      const style = window.getComputedStyle(container);
      const colGap = parsePx(style.columnGap || style.gap);
      const rowGap = parsePx(style.rowGap || style.gap);
      const paddingLeft = parsePx(style.paddingLeft);
      const paddingRight = parsePx(style.paddingRight);
      const paddingTop = parsePx(style.paddingTop);
      const rowHeight = parsePx(style.gridAutoRows) || 175;
      const innerWidth = Math.max(0, rect.width - paddingLeft - paddingRight);
      const cellWidth = maxCols > 0
        ? (innerWidth - colGap * Math.max(0, maxCols - 1)) / maxCols
        : innerWidth;

      return {
        rect,
        colGap,
        rowGap,
        paddingLeft,
        paddingTop,
        rowHeight,
        cellWidth,
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
      };
    }

    function ensureOccupancyRows(occupancy: boolean[][], rowCount: number, cols: number) {
      while (occupancy.length < rowCount) {
        occupancy.push(Array.from({ length: cols }, () => false));
      }
    }

    function canPlaceAt(
      occupancy: boolean[][],
      row: number,
      col: number,
      colSpan: number,
      rowSpan: number,
      cols: number
    ) {
      if (col < 0 || col + colSpan > cols) return false;
      ensureOccupancyRows(occupancy, row + rowSpan, cols);
      for (let r = row; r < row + rowSpan; r++) {
        for (let c = col; c < col + colSpan; c++) {
          if (occupancy[r]?.[c]) return false;
        }
      }
      return true;
    }

    function markOccupied(
      occupancy: boolean[][],
      row: number,
      col: number,
      colSpan: number,
      rowSpan: number,
      cols: number
    ) {
      ensureOccupancyRows(occupancy, row + rowSpan, cols);
      for (let r = row; r < row + rowSpan; r++) {
        for (let c = col; c < col + colSpan; c++) {
          occupancy[r][c] = true;
        }
      }
    }

    function findPlacementSlot(
      occupancy: boolean[][],
      cols: number,
      colSpan: number,
      rowSpan: number
    ) {
      for (let row = 0; row < 512; row++) {
        for (let col = 0; col <= cols - colSpan; col++) {
          if (canPlaceAt(occupancy, row, col, colSpan, rowSpan, cols)) {
            return { row, col };
          }
        }
      }
      return { row: 0, col: 0 };
    }

    function makePanelRect(
      rect: DOMRect,
      paddingLeft: number,
      paddingTop: number,
      scrollLeft: number,
      scrollTop: number,
      cellWidth: number,
      rowHeight: number,
      colGap: number,
      rowGap: number,
      row: number,
      col: number,
      colSpan: number,
      rowSpan: number
    ) {
      return new DOMRect(
        rect.left + paddingLeft - scrollLeft + col * (cellWidth + colGap),
        rect.top + paddingTop - scrollTop + row * (rowHeight + rowGap),
        cellWidth * colSpan + colGap * Math.max(0, colSpan - 1),
        rowHeight * rowSpan + rowGap * Math.max(0, rowSpan - 1)
      );
    }

    function simulatePanels(
      snapshot: Pick<ContainerSnapshot, "rect" | "cellWidth" | "rowHeight" | "colGap" | "rowGap" | "paddingLeft" | "paddingTop" | "scrollLeft" | "scrollTop">,
      items: LayoutItem[],
      cols: number
    ) {
      const occupancy: boolean[][] = [];
      const panels: SnapshotPanel[] = [];

      items.forEach((item, index) => {
        const slot = findPlacementSlot(occupancy, cols, item.colSpan, item.rowSpan);
        markOccupied(occupancy, slot.row, slot.col, item.colSpan, item.rowSpan, cols);
        panels.push({
          el: item.el,
          id: item.id,
          colSpan: item.colSpan,
          rowSpan: item.rowSpan,
          index,
          rect: makePanelRect(
            snapshot.rect,
            snapshot.paddingLeft,
            snapshot.paddingTop,
            snapshot.scrollLeft,
            snapshot.scrollTop,
            snapshot.cellWidth,
            snapshot.rowHeight,
            snapshot.colGap,
            snapshot.rowGap,
            slot.row,
            slot.col,
            item.colSpan,
            item.rowSpan
          ),
        });
      });

      return panels;
    }

    function buildPreviewRects(
      snapshot: Pick<ContainerSnapshot, "rect" | "cellWidth" | "rowHeight" | "colGap" | "rowGap" | "paddingLeft" | "paddingTop" | "scrollLeft" | "scrollTop">,
      items: LayoutItem[],
      containerIdx: number
    ) {
      const maxCols = Math.max(1, configRef.current.grids[containerIdx]?.maxCols ?? 1);
      const dragItem: LayoutItem = {
        el: placeholder ?? sourcePanel ?? getContainers()[containerIdx] ?? document.body,
        id: sourcePanel?.getAttribute("data-panel") || "__drag__",
        colSpan: clampDraggedColSpan(containerIdx),
        rowSpan: sourceRowSpan,
      };

      return Array.from({ length: items.length + 1 }, (_, insertIndex) => {
        const nextItems = [...items];
        nextItems.splice(insertIndex, 0, dragItem);
        const simulated = simulatePanels(snapshot, nextItems, maxCols);
        return simulated[insertIndex]?.rect ?? null;
      }).filter((rect): rect is DOMRect => Boolean(rect));
    }

    function clampDraggedColSpan(containerIdx: number) {
      const maxCols = Math.max(1, configRef.current.grids[containerIdx]?.maxCols ?? 1);
      return Math.max(1, Math.min(sourceColSpan, maxCols));
    }

    function distanceToRect(clientX: number, clientY: number, rect: DOMRect) {
      const dx = clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
      const dy = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      if (dx === 0 && dy === 0) {
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        return ((clientX - centerX) ** 2 + (clientY - centerY) ** 2) * 0.0001;
      }
      return dx * dx + dy * dy;
    }

    function getAnimatableElements() {
      return getContainers().flatMap((container) =>
        Array.from(container.children).filter(
          (child): child is HTMLElement =>
            child instanceof HTMLElement &&
            child !== sourcePanel &&
            (child === placeholder || child.hasAttribute("data-panel"))
        )
      );
    }

    function clearElementLayoutAnimation(el: HTMLElement) {
      const timeoutId = layoutAnimationTimeouts.get(el);
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
        layoutAnimationTimeouts.delete(el);
      }
      stableLayoutRects.delete(el);
      el.style.removeProperty("transition");
      el.style.removeProperty("transform");
      el.style.removeProperty("transform-origin");
      el.style.removeProperty("will-change");
    }

    function clearAllLayoutAnimations() {
      for (const el of getAnimatableElements()) {
        clearElementLayoutAnimation(el);
      }
      layoutAnimationTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
      layoutAnimationTimeouts.clear();
      stableLayoutRects.clear();
    }

    function captureLayoutState() {
      const elements = getAnimatableElements();
      const rects = new Map<HTMLElement, DOMRect>();
      for (const el of elements) {
        rects.set(el, el.getBoundingClientRect());
      }
      for (const el of elements) {
        clearElementLayoutAnimation(el);
      }
      return rects;
    }

    function animateLayoutShift(previousRects: Map<HTMLElement, DOMRect>) {
      const elements = getAnimatableElements();
      const animations: Array<{
        el: HTMLElement;
        dx: number;
        dy: number;
        scaleX: number;
        scaleY: number;
      }> = [];

      for (const el of elements) {
        const prevRect = previousRects.get(el);
        if (!prevRect) continue;
        const nextRect = el.getBoundingClientRect();
        if (nextRect.width === 0 || nextRect.height === 0) continue;

        const dx = prevRect.left - nextRect.left;
        const dy = prevRect.top - nextRect.top;
        const scaleX = prevRect.width / nextRect.width;
        const scaleY = prevRect.height / nextRect.height;

        if (
          Math.abs(dx) < 0.5 &&
          Math.abs(dy) < 0.5 &&
          Math.abs(scaleX - 1) < 0.01 &&
          Math.abs(scaleY - 1) < 0.01
        ) {
          continue;
        }

        stableLayoutRects.set(el, nextRect);
        animations.push({ el, dx, dy, scaleX, scaleY });
      }

      if (animations.length === 0) return;

      for (const { el, dx, dy, scaleX, scaleY } of animations) {
        clearElementLayoutAnimation(el);
        el.style.setProperty("transform-origin", "top left");
        el.style.setProperty("will-change", "transform");
        el.style.setProperty("transition", "none", "important");
        el.style.setProperty(
          "transform",
          `translate3d(${dx}px, ${dy}px, 0) scale(${scaleX}, ${scaleY})`
        );
      }

      void document.body.offsetHeight;

      requestAnimationFrame(() => {
        for (const { el } of animations) {
          el.style.setProperty(
            "transition",
            `transform ${LAYOUT_ANIMATION_MS}ms ${LAYOUT_ANIMATION_EASING}`,
            "important"
          );
          el.style.setProperty("transform", "translate3d(0, 0, 0) scale(1, 1)");
          const timeoutId = window.setTimeout(() => {
            clearElementLayoutAnimation(el);
          }, LAYOUT_ANIMATION_MS + 34);
          layoutAnimationTimeouts.set(el, timeoutId);
        }
      });
    }

    function snapshotLayout() {
      const _t0 = PANEL_DRAG_PERF ? performance.now() : 0;
      layoutSnapshot = getContainers().map((container, idx) => {
        const maxCols = Math.max(1, configRef.current.grids[idx]?.maxCols ?? 1);
        const metrics = buildContainerMetrics(container, maxCols);
        const items = getPanelElements(container)
          .map((el) => getPanelLayoutItem(el))
          .filter((item): item is LayoutItem => Boolean(item));
        const panels = simulatePanels(metrics, items, maxCols);

        return {
          container,
          rect: metrics.rect,
          items,
          previewRects: buildPreviewRects(metrics, items, idx),
          cellWidth: metrics.cellWidth,
          rowHeight: metrics.rowHeight,
          colGap: metrics.colGap,
          rowGap: metrics.rowGap,
          paddingLeft: metrics.paddingLeft,
          paddingTop: metrics.paddingTop,
          scrollLeft: metrics.scrollLeft,
          scrollTop: metrics.scrollTop,
          panels,
        };
      });
      if (PANEL_DRAG_PERF) {
        const elapsed = performance.now() - _t0;
        perfSnapshotTotalMs += elapsed;
        perfSnapshotCount++;
      }

      debugLog("snapshotLayout", {
        grids: layoutSnapshot.map((grid, idx) => ({
          idx,
          panels: grid.panels.map((panel) => ({
            id: panel.id,
            top: Math.round(panel.rect.top),
            left: Math.round(panel.rect.left),
            width: Math.round(panel.rect.width),
            height: Math.round(panel.rect.height),
          })),
        })),
      });
    }

    function getContainerRect(container: HTMLElement) {
      return layoutSnapshot.find((entry) => entry.container === container)?.rect
        ?? container.getBoundingClientRect();
    }

    function getScrollableContainerAtPoint(clientX: number, clientY: number) {
      const preferredContainer = lastTargetContainerIdx >= 0
        ? getContainers()[lastTargetContainerIdx]
        : null;

      if (preferredContainer) {
        const rect = getContainerRect(preferredContainer);
        if (
          isPointInsideRect(rect, clientX, clientY, AUTO_SCROLL_OUTSIDE_TOLERANCE_PX) &&
          preferredContainer.scrollHeight > preferredContainer.clientHeight + 1
        ) {
          return { container: preferredContainer, rect };
        }
      }

      const containers = getContainers();
      for (const container of containers) {
        const rect = getContainerRect(container);
        if (!isPointInsideRect(rect, clientX, clientY, AUTO_SCROLL_OUTSIDE_TOLERANCE_PX)) continue;
        if (container.scrollHeight <= container.clientHeight + 1) continue;
        return { container, rect };
      }
      return null;
    }

    function computeAutoScrollDelta(container: HTMLElement, rect: DOMRect, clientY: number) {
      if (container.scrollHeight <= container.clientHeight + 1) return 0;

      const topDistance = clientY - rect.top;
      const bottomDistance = rect.bottom - clientY;

      if (
        topDistance < AUTO_SCROLL_EDGE_PX &&
        topDistance > -AUTO_SCROLL_OUTSIDE_TOLERANCE_PX &&
        container.scrollTop > 0
      ) {
        const ratio = 1 - Math.min(
          1,
          (topDistance + AUTO_SCROLL_OUTSIDE_TOLERANCE_PX) /
            (AUTO_SCROLL_EDGE_PX + AUTO_SCROLL_OUTSIDE_TOLERANCE_PX)
        );
        return -Math.max(4, Math.round(ratio * AUTO_SCROLL_MAX_STEP_PX));
      }

      const maxScrollTop = container.scrollHeight - container.clientHeight;
      if (
        bottomDistance < AUTO_SCROLL_EDGE_PX &&
        bottomDistance > -AUTO_SCROLL_OUTSIDE_TOLERANCE_PX &&
        container.scrollTop < maxScrollTop
      ) {
        const ratio = 1 - Math.min(
          1,
          (bottomDistance + AUTO_SCROLL_OUTSIDE_TOLERANCE_PX) /
            (AUTO_SCROLL_EDGE_PX + AUTO_SCROLL_OUTSIDE_TOLERANCE_PX)
        );
        return Math.max(4, Math.round(ratio * AUTO_SCROLL_MAX_STEP_PX));
      }

      return 0;
    }

    function applyAutoScroll(clientX: number, clientY: number) {
      const hit = getScrollableContainerAtPoint(clientX, clientY);
      if (!hit) return false;

      const deltaY = computeAutoScrollDelta(hit.container, hit.rect, clientY);
      if (deltaY === 0) return false;

      const prevScrollTop = hit.container.scrollTop;
      hit.container.scrollTop += deltaY;
      if (hit.container.scrollTop === prevScrollTop) return false;

      clearAllLayoutAnimations();
      snapshotStale = true;
      return true;
    }

    function stopAutoScrollLoop() {
      if (!autoScrollFrameId) return;
      cancelAnimationFrame(autoScrollFrameId);
      autoScrollFrameId = 0;
    }

    function ensureAutoScrollLoop() {
      if (autoScrollFrameId || !active) return;
      autoScrollFrameId = requestAnimationFrame(function tick() {
        autoScrollFrameId = 0;
        if (!active) return;

        const scrolled = applyAutoScroll(latestClientX, latestClientY);
        if (scrolled) {
          scheduledDrag();
        }

        const hit = getScrollableContainerAtPoint(latestClientX, latestClientY);
        if (hit && computeAutoScrollDelta(hit.container, hit.rect, latestClientY) !== 0) {
          ensureAutoScrollLoop();
        }
      });
    }

    function findPanel(el: HTMLElement | null, container: HTMLElement): HTMLElement | null {
      while (el && el !== container) {
        if (el.hasAttribute("data-panel")) return el;
        el = el.parentElement;
      }
      return null;
    }

    function findContainerIdxForElement(el: HTMLElement): number {
      const containers = getContainers();
      for (let i = 0; i < containers.length; i++) {
        if (containers[i].contains(el)) return i;
      }
      return -1;
    }

    function isPointInsideRect(rect: DOMRect, clientX: number, clientY: number, tolerance = 0) {
      return (
        clientX >= rect.left - tolerance &&
        clientX <= rect.right + tolerance &&
        clientY >= rect.top - tolerance &&
        clientY <= rect.bottom + tolerance
      );
    }

    function findContainerIdxAtPoint(clientX: number, clientY: number): number {
      for (let i = 0; i < layoutSnapshot.length; i++) {
        if (isPointInsideRect(layoutSnapshot[i].rect, clientX, clientY, CONTAINER_EDGE_TOLERANCE_PX)) {
          return i;
        }
      }
      return -1;
    }

    function getPlaceholderRectForInsertion(containerIdx: number, insertIndex: number) {
      const snapshot = layoutSnapshot[containerIdx];
      if (!snapshot) return null;
      return snapshot.previewRects[insertIndex] ?? null;
    }

    function resolveInsertionTarget(containerIdx: number, clientX: number, clientY: number): DropTarget | null {
      const snapshot = layoutSnapshot[containerIdx];
      if (!snapshot) return null;

      const candidateCount = snapshot.items.length + 1;
      let bestTarget: DropTarget | null = null;
      let bestScore = Number.POSITIVE_INFINITY;

      for (let insertIndex = 0; insertIndex < candidateCount; insertIndex++) {
        const previewRect = getPlaceholderRectForInsertion(containerIdx, insertIndex);
        if (!previewRect) continue;
        if (isPointInsideRect(previewRect, clientX, clientY)) {
          return { containerIdx, insertIndex, previewRect };
        }
        const score = distanceToRect(clientX, clientY, previewRect);
        if (score < bestScore) {
          bestScore = score;
          bestTarget = { containerIdx, insertIndex, previewRect };
        }
      }

      return bestTarget;
    }

    function computeDropTarget(clientX: number, clientY: number): DropTarget | null {
      if (!sourcePanel) return null;
      const containerIdx = findContainerIdxAtPoint(clientX, clientY);
      if (containerIdx === -1) {
        debugLog("computeDropTarget:noContainer", {
          clientX: Math.round(clientX),
          clientY: Math.round(clientY),
          containerRects: layoutSnapshot.map((snap, i) => ({
            idx: i,
            left: Math.round(snap.rect.left),
            top: Math.round(snap.rect.top),
            right: Math.round(snap.rect.right),
            bottom: Math.round(snap.rect.bottom),
          })),
        });
        return null;
      }

      let target: DropTarget | null;
      if (PANEL_DRAG_PERF) {
        const _t0 = performance.now();
        target = resolveInsertionTarget(containerIdx, clientX, clientY);
        perfHitTestMs += performance.now() - _t0;
      } else {
        target = resolveInsertionTarget(containerIdx, clientX, clientY);
      }

      if ((computeDropTarget as { _lastHit?: string })._lastHit !== `${containerIdx}:${target?.insertIndex ?? "none"}`) {
        (computeDropTarget as { _lastHit?: string })._lastHit = `${containerIdx}:${target?.insertIndex ?? "none"}`;
        debugLog("computeDropTarget:hit", {
          containerIdx,
          insertIndex: target?.insertIndex ?? null,
          clientX: Math.round(clientX),
          clientY: Math.round(clientY),
          previewRect: target?.previewRect
            ? {
                left: Math.round(target.previewRect.left),
                top: Math.round(target.previewRect.top),
                width: Math.round(target.previewRect.width),
                height: Math.round(target.previewRect.height),
              }
            : null,
        });
      }

      return target;
    }

    function getTargetKey(target: DropTarget | null) {
      if (!target) return "none";
      return `${target.containerIdx}:index:${target.insertIndex}`;
    }

    function clearContainerTargets() {
      for (const container of getContainers()) {
        container.classList.remove("panel-drop-target");
      }
    }

    function createGhost(panel: HTMLElement, clientX: number, clientY: number) {
      const panelTitle = panel.querySelector(".panel-title")?.textContent?.trim()
        || panel.getAttribute("data-panel")
        || "";
      const countText = panel.querySelector(".panel-count")?.textContent?.trim() ?? "";
      const badgeText = panel.querySelector(".panel-data-badge")?.textContent?.trim() ?? "";

      const ghostWidth = sourceRect ? Math.max(240, Math.min(Math.round(sourceRect.width * Math.min(1, 460 / sourceRect.width)), 460)) : 320;
      const ghostHeight = sourceRect ? Math.max(140, Math.min(Math.round(sourceRect.height * Math.min(1, 320 / sourceRect.height)), 320)) : 220;
      const metaText = countText || badgeText;

      if (sourceRect) {
        const scaleX = ghostWidth / Math.max(sourceRect.width, 1);
        const scaleY = ghostHeight / Math.max(sourceRect.height, 1);
        ghostOffsetX = Math.max(12, Math.min(ghostWidth - 12, (clientX - sourceRect.left) * scaleX));
        ghostOffsetY = Math.max(12, Math.min(ghostHeight - 12, (clientY - sourceRect.top) * scaleY));
      } else {
        ghostOffsetX = 18;
        ghostOffsetY = 14;
      }

      ghost = document.createElement("div");
      ghost.className = "panel-drag-ghost";
      ghost.style.width = `${ghostWidth}px`;
      ghost.style.height = `${ghostHeight}px`;
      ghost.innerHTML = `
        <div class="panel-drag-ghost__header">
          <span class="panel-drag-ghost__grip" aria-hidden="true">
            <span></span><span></span><span></span><span></span><span></span><span></span>
          </span>
          <span class="panel-drag-ghost__title">${escapeHtml(panelTitle)}</span>
          ${metaText ? `<span class="panel-drag-ghost__meta">${escapeHtml(metaText)}</span>` : ""}
        </div>
        <div class="panel-drag-ghost__body" aria-hidden="true">
          <span class="panel-drag-ghost__line w-90"></span>
          <span class="panel-drag-ghost__line w-60"></span>
          <span class="panel-drag-ghost__line w-75"></span>
          <span class="panel-drag-ghost__line w-45"></span>
        </div>
      `;

      document.body.appendChild(ghost);
    }

    function moveGhost(clientX: number, clientY: number) {
      if (!ghost) return;
      ghost.style.transform = `translate3d(${clientX - ghostOffsetX}px, ${clientY - ghostOffsetY}px, 0)`;
    }

    function removeGhost() {
      if (ghost) {
        ghost.remove();
        ghost = null;
      }
    }

    function createPlaceholder(panel: HTMLElement) {
      const panelTitle = panel.querySelector(".panel-title")?.textContent?.trim()
        || panel.getAttribute("data-panel")
        || "Panel";

      placeholder = document.createElement("div");
      placeholder.className = "panel-drop-placeholder";
      placeholder.setAttribute("aria-hidden", "true");
      if (panel.style.gridColumn) placeholder.style.gridColumn = panel.style.gridColumn;
      if (panel.style.gridRow) placeholder.style.gridRow = panel.style.gridRow;
      placeholder.innerHTML = `
        <div class="panel-drop-placeholder__header">
          <span class="panel-drop-placeholder__label">${escapeHtml(panelTitle)}</span>
        </div>
        <div class="panel-drop-placeholder__body">
          <span class="panel-drop-placeholder__hint">drop preview</span>
        </div>
      `;

      panel.insertAdjacentElement("afterend", placeholder);
    }

    function applyPlaceholderSpan(containerIdx: number) {
      if (!placeholder) return;
      const maxCols = Math.max(1, configRef.current.grids[containerIdx]?.maxCols ?? 1);
      const nextColSpan = Math.max(1, Math.min(sourceColSpan, maxCols));
      placeholder.style.gridColumn = nextColSpan > 1 ? `span ${nextColSpan}` : "";
      placeholder.style.gridRow = sourceRowSpan !== 2 ? `span ${sourceRowSpan}` : "";
    }

    function removePlaceholder() {
      if (placeholder) {
        placeholder.remove();
        placeholder = null;
      }
    }

    function movePlaceholderToTarget(target: DropTarget) {
      if (!placeholder) return false;
      const containers = getContainers();
      const container = containers[target.containerIdx];
      if (!container) return false;

      applyPlaceholderSpan(target.containerIdx);
      const currentSequence = Array.from(container.children).filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement &&
          (child === placeholder || (child !== sourcePanel && child.hasAttribute("data-panel")))
      );
      const currentIndex = currentSequence.indexOf(placeholder);
      if (placeholder.parentElement === container && currentIndex === target.insertIndex) {
        lastTargetContainerIdx = target.containerIdx;
        return false;
      }

      const actualPanels = getPanelElements(container);
      const referenceNode = actualPanels[target.insertIndex] ?? null;
      const previousRects = captureLayoutState();
      container.insertBefore(placeholder, referenceNode);
      animateLayoutShift(previousRects);
      lastTargetContainerIdx = target.containerIdx;
      return true;
    }

    function getProjectedVisibleOrder(containerIdx: number): string[] {
      const container = getContainers()[containerIdx];
      const sourceId = sourcePanel?.getAttribute("data-panel");
      if (!container || !sourceId) return [];

      const projected: string[] = [];
      for (const child of Array.from(container.children)) {
        if (!(child instanceof HTMLElement) || child === sourcePanel) continue;
        if (child === placeholder) {
          projected.push(sourceId);
          continue;
        }
        const id = child.getAttribute("data-panel");
        if (id) projected.push(id);
      }
      return projected;
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

    function mergeTransferredOrder(
      fullOrder: string[],
      projectedVisibleOrder: string[],
      excludedIds: string[] = []
    ) {
      const visibleSet = new Set(projectedVisibleOrder);
      const excludedSet = new Set(excludedIds);
      return [
        ...projectedVisibleOrder,
        ...fullOrder.filter((id) => !visibleSet.has(id) && !excludedSet.has(id)),
      ];
    }

    function updateDropTarget(clientX: number, clientY: number) {
      let _t0: number;

      _t0 = PANEL_DRAG_PERF ? performance.now() : 0;
      const target = computeDropTarget(clientX, clientY);
      if (PANEL_DRAG_PERF) perfComputeDropMs += performance.now() - _t0;

      const nextKey = getTargetKey(target);
      if (nextKey === lastTargetKey) return;
      debugLog("updateDropTarget:newTarget", { prevKey: lastTargetKey, nextKey });

      lastTargetKey = nextKey;
      clearContainerTargets();

      if (!target) {
        debugLog("updateDropTarget:none", {
          clientX: Math.round(clientX),
          clientY: Math.round(clientY),
        });
        return;
      }

      _t0 = PANEL_DRAG_PERF ? performance.now() : 0;
      const moved = movePlaceholderToTarget(target);
      if (PANEL_DRAG_PERF) perfMovePlaceholderMs += performance.now() - _t0;

      getContainers()[target.containerIdx]?.classList.add("panel-drop-target");

      if (moved) {
        snapshotStale = true;
        debugLog("updateDropTarget:moved", {
          clientX: Math.round(clientX),
          clientY: Math.round(clientY),
          targetContainerIdx: target.containerIdx,
          insertIndex: target.insertIndex,
          previewRect: {
            left: Math.round(target.previewRect.left),
            top: Math.round(target.previewRect.top),
            width: Math.round(target.previewRect.width),
            height: Math.round(target.previewRect.height),
          },
        });
      }
    }

    function beginDrag(clientX: number, clientY: number, target: HTMLElement) {
      if (target.closest("button, input, select, textarea, .panel-content")) return;
      const handle = target.closest(".drag-handle") as HTMLElement | null;
      if (!handle) return;

      const containerIdx = findContainerIdxForElement(handle);
      if (containerIdx === -1) return;
      const container = getContainers()[containerIdx];
      const panel = findPanel(handle, container);
      if (!panel) return;

      sourcePanel = panel;
      sourceContainerIdx = containerIdx;
      startX = clientX;
      startY = clientY;
      active = false;
      lastTargetKey = "none";
      lastTargetContainerIdx = containerIdx;
      sourceRect = null;

      debugLog("beginDrag", {
        sourceId: sourcePanel.getAttribute("data-panel"),
        sourceContainerIdx,
        startX: Math.round(clientX),
        startY: Math.round(clientY),
      });

      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
      document.addEventListener("pointercancel", onPointerCancel);
    }

    function moveDrag(clientX: number, clientY: number) {
      if (!sourcePanel) return;

      if (!active) {
        const dx = clientX - startX;
        const dy = clientY - startY;
        if (dx * dx + dy * dy < DRAG_THRESHOLD_SQ) return;

        active = true;
        const _activateT0 = PANEL_DRAG_PERF ? performance.now() : 0;

        sourceRect = sourcePanel.getBoundingClientRect();
        sourceColSpan = sourcePanel.style.gridColumn
          ? Number.parseInt(sourcePanel.style.gridColumn.replace(/[^0-9]/g, ""), 10) || 1
          : 1;
        sourceRowSpan = sourcePanel.style.gridRow
          ? Number.parseInt(sourcePanel.style.gridRow.replace(/[^0-9]/g, ""), 10) || 2
          : 2;
        const previousRects = captureLayoutState();
        createPlaceholder(sourcePanel);
        sourcePanel.classList.add("panel-dragging", "panel-drag-source-hidden");
        animateLayoutShift(previousRects);
        createGhost(sourcePanel, clientX, clientY);
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        document.body.classList.add("panel-drag-active");
        configRef.current.onDragStateChange?.(true);
        // Defer snapshot to first RAF — avoids 87ms sync reflow during pointer event
        snapshotStale = true;

        if (PANEL_DRAG_PERF) {
          console.log(`[drag-perf] activateDrag took ${(performance.now() - _activateT0).toFixed(1)}ms`);
        }
        perfReset();

        debugLog("activateDrag", {
          sourceId: sourcePanel.getAttribute("data-panel"),
          sourceContainerIdx,
          sourceRect: sourceRect
            ? {
                top: Math.round(sourceRect.top),
                left: Math.round(sourceRect.left),
                width: Math.round(sourceRect.width),
                height: Math.round(sourceRect.height),
              }
            : null,
        });
      }

      latestClientX = clientX;
      latestClientY = clientY;
      scheduledDrag();
      ensureAutoScrollLoop();
    }

    function endDrag() {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
      scheduledDrag.cancel();
      stopAutoScrollLoop();
      if (PANEL_DRAG_PERF && active) {
        perfReport(); // flush final stats
        console.log("[drag-perf] drag ended");
      }
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.body.classList.remove("panel-drag-active");

      if (active && sourcePanel) {
        const sourceId = sourcePanel.getAttribute("data-panel");
        const cfg = configRef.current;

        if (sourceId && lastTargetContainerIdx === sourceContainerIdx) {
          const projectedSameOrder = getProjectedVisibleOrder(sourceContainerIdx);
          const fullOrder = [...cfg.grids[sourceContainerIdx].panelOrder];
          const newOrder = mergeVisibleOrder(fullOrder, projectedSameOrder);
          debugLog("endDrag:sameContainer", {
            sourceId, containerIdx: sourceContainerIdx,
            projected: projectedSameOrder, fullOrder, newOrder,
            changed: !arraysEqual(fullOrder, newOrder),
          });
          if (!arraysEqual(fullOrder, newOrder)) {
            cfg.grids[sourceContainerIdx].onReorder(newOrder);
          }
        } else if (sourceId && lastTargetContainerIdx >= 0) {
          const fromGrid = cfg.grids[sourceContainerIdx];
          const toGrid = cfg.grids[lastTargetContainerIdx];
          const projectedFromOrder = getProjectedVisibleOrder(sourceContainerIdx);
          const projectedToOrder = getProjectedVisibleOrder(lastTargetContainerIdx);
          const newFromOrder = mergeTransferredOrder(fromGrid.panelOrder, projectedFromOrder, [sourceId]);
          const newToOrder = mergeTransferredOrder(toGrid.panelOrder, projectedToOrder);

          debugLog("endDrag:transfer", {
            sourceId,
            from: sourceContainerIdx, to: lastTargetContainerIdx,
            projectedFrom: projectedFromOrder, projectedTo: projectedToOrder,
            newFromOrder, newToOrder,
            changed: !arraysEqual(fromGrid.panelOrder, newFromOrder)
              || !arraysEqual(toGrid.panelOrder, newToOrder),
          });

          if (
            !arraysEqual(fromGrid.panelOrder, newFromOrder)
            || !arraysEqual(toGrid.panelOrder, newToOrder)
          ) {
            cfg.onTransfer?.(
              sourceId,
              sourceContainerIdx,
              lastTargetContainerIdx,
              newFromOrder,
              newToOrder
            );
          }
        } else {
          debugLog("endDrag:noop", {
            sourceId, sourceContainerIdx, lastTargetContainerIdx,
          });
        }
      }

      if (sourcePanel) {
        sourcePanel.classList.remove("panel-dragging", "panel-drag-source-hidden");
      }
      clearContainerTargets();
      removePlaceholder();
      removeGhost();
      clearAllLayoutAnimations();
      sourcePanel = null;
      sourceRect = null;
      sourceColSpan = 1;
      sourceRowSpan = 2;
      ghostOffsetX = 18;
      ghostOffsetY = 14;
      active = false;
      sourceContainerIdx = -1;
      lastTargetContainerIdx = -1;
      lastTargetKey = "none";
      layoutSnapshot = [];
      configRef.current.onDragStateChange?.(false);
    }

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return;
      beginDrag(e.clientX, e.clientY, e.target as HTMLElement);
    }

    function onPointerMove(e: PointerEvent) {
      if (active) e.preventDefault();
      moveDrag(e.clientX, e.clientY);
    }

    function onPointerUp() {
      endDrag();
    }

    function onPointerCancel() {
      endDrag();
    }

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
      document.removeEventListener("pointercancel", onPointerCancel);
      scheduledDrag.cancel();
      stopAutoScrollLoop();
      clearContainerTargets();
      removePlaceholder();
      removeGhost();
      clearAllLayoutAnimations();
    };
  }, []);
}
