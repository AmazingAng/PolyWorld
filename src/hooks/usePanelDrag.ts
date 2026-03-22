import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { rafSchedule } from "@/lib/rafSchedule";

const DRAG_THRESHOLD = 8;
const CONTAINER_EDGE_TOLERANCE_PX = 24;
const GLOBAL_TARGET_SNAP_DISTANCE_PX = 240;
const OVERLAY_CURSOR_MIN_MARGIN_PX = 12;

interface PanelDragGrid {
  ref: React.RefObject<HTMLElement | null>;
  visibleOrder: string[];
  fullOrder: string[];
  onReorder: (order: string[]) => void;
  maxCols: number;
}

interface PanelGeometry {
  title: string;
  metaText?: string;
  colSpan: number;
  rowSpan: number;
}

interface LayoutItem {
  id: string;
  colSpan: number;
  rowSpan: number;
}

interface SimulatedPanelPlacement {
  id: string;
  row: number;
  col: number;
  colSpan: number;
  rowSpan: number;
  rect: DOMRect;
}

interface ContainerMetrics {
  rect: DOMRect;
  cellWidth: number;
  rowHeight: number;
  colGap: number;
  rowGap: number;
  paddingLeft: number;
  paddingTop: number;
  scrollLeft: number;
  scrollTop: number;
}

interface DropTarget {
  containerIdx: number;
  insertIndex: number;
  previewRect: DOMRect;
}

interface PreviewCandidate extends DropTarget {
  row: number;
  col: number;
  colSpan: number;
  rowSpan: number;
}

interface OverlayPointerState {
  active: boolean;
  startClientX: number;
  startClientY: number;
  originLeft: number;
  originTop: number;
  anchorX: number;
  anchorY: number;
}

interface DragRuntimeState {
  activeId: string | null;
  sourceContainerIdx: number;
  latestClientX: number;
  latestClientY: number;
  projectedVisibleOrders: string[][] | null;
  lastTargetKey: string;
}

export interface PanelDragOverlayData {
  title: string;
  metaText: string;
  width: number;
  height: number;
}

function arraysEqual(a: string[], b: string[]) {
  return a.length === b.length && a.every((item, idx) => item === b[idx]);
}

function parsePx(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildContainerMetrics(container: HTMLElement, maxCols: number): ContainerMetrics {
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
    cellWidth,
    rowHeight,
    colGap,
    rowGap,
    paddingLeft,
    paddingTop,
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
  cols: number,
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
  cols: number,
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
  rowSpan: number,
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
  metrics: ContainerMetrics,
  row: number,
  col: number,
  colSpan: number,
  rowSpan: number,
) {
  return new DOMRect(
    metrics.rect.left + metrics.paddingLeft - metrics.scrollLeft + col * (metrics.cellWidth + metrics.colGap),
    metrics.rect.top + metrics.paddingTop - metrics.scrollTop + row * (metrics.rowHeight + metrics.rowGap),
    metrics.cellWidth * colSpan + metrics.colGap * Math.max(0, colSpan - 1),
    metrics.rowHeight * rowSpan + metrics.rowGap * Math.max(0, rowSpan - 1),
  );
}

function simulatePanels(metrics: ContainerMetrics, items: LayoutItem[], cols: number): SimulatedPanelPlacement[] {
  const occupancy: boolean[][] = [];

  return items.map((item) => {
    const slot = findPlacementSlot(occupancy, cols, item.colSpan, item.rowSpan);
    markOccupied(occupancy, slot.row, slot.col, item.colSpan, item.rowSpan, cols);
    return {
      id: item.id,
      row: slot.row,
      col: slot.col,
      colSpan: item.colSpan,
      rowSpan: item.rowSpan,
      rect: makePanelRect(metrics, slot.row, slot.col, item.colSpan, item.rowSpan),
    };
  });
}

function buildPreviewRects(
  metrics: ContainerMetrics,
  items: LayoutItem[],
  dragItem: LayoutItem,
  cols: number,
) : PreviewCandidate[] {
  return Array.from({ length: items.length + 1 }, (_, insertIndex) => {
    const nextItems = [...items];
    nextItems.splice(insertIndex, 0, dragItem);
    const simulated = simulatePanels(metrics, nextItems, cols);
    const placement = simulated[insertIndex];
    if (!placement) return null;
    return {
      insertIndex,
      previewRect: placement.rect,
      row: placement.row,
      col: placement.col,
      colSpan: placement.colSpan,
      rowSpan: placement.rowSpan,
    };
  }).filter((candidate): candidate is PreviewCandidate => Boolean(candidate));
}

function distanceToRect(clientX: number, clientY: number, rect: DOMRect) {
  const dx = clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
  const dy = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
  if (dx === 0 && dy === 0) return 0;
  return dx * dx + dy * dy;
}

function scorePreviewRect(clientX: number, clientY: number, rect: DOMRect) {
  const outsideDistance = distanceToRect(clientX, clientY, rect);
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = clientX - centerX;
  const dy = clientY - centerY;
  const centerDistance = dx * dx + dy * dy;

  if (outsideDistance === 0) {
    return centerDistance;
  }

  return outsideDistance * 16 + centerDistance;
}

function getPointerGridCell(metrics: ContainerMetrics, clientX: number, clientY: number) {
  const colUnit = metrics.cellWidth + metrics.colGap;
  const rowUnit = metrics.rowHeight + metrics.rowGap;
  const localX = clientX - metrics.rect.left - metrics.paddingLeft + metrics.scrollLeft;
  const localY = clientY - metrics.rect.top - metrics.paddingTop + metrics.scrollTop;

  const col = Math.max(0, Math.floor(localX / Math.max(1, colUnit)));
  const row = Math.max(0, Math.floor(localY / Math.max(1, rowUnit)));

  return { row, col };
}

function candidateContainsCell(candidate: PreviewCandidate, row: number, col: number) {
  return (
    row >= candidate.row &&
    row < candidate.row + candidate.rowSpan &&
    col >= candidate.col &&
    col < candidate.col + candidate.colSpan
  );
}

function isPointInsideRect(rect: DOMRect, clientX: number, clientY: number, tolerance = 0) {
  return (
    clientX >= rect.left - tolerance &&
    clientX <= rect.right + tolerance &&
    clientY >= rect.top - tolerance &&
    clientY <= rect.bottom + tolerance
  );
}

function mergeVisibleOrder(fullOrder: string[], projectedVisibleOrder: string[]) {
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
  excludedIds: string[] = [],
) {
  const visibleSet = new Set(projectedVisibleOrder);
  const excludedSet = new Set(excludedIds);
  return [
    ...projectedVisibleOrder,
    ...fullOrder.filter((id) => !visibleSet.has(id) && !excludedSet.has(id)),
  ];
}

function readClientPoint(
  event:
    | Event
    | MouseEvent
    | PointerEvent
    | TouchEvent
    | { clientX?: number; clientY?: number; touches?: TouchList; changedTouches?: TouchList }
    | null
    | undefined,
): { clientX: number; clientY: number } | null {
  if (!event) return null;
  if ("touches" in event && event.touches && event.touches.length > 0) {
    const touch = event.touches[0];
    return { clientX: touch.clientX, clientY: touch.clientY };
  }
  if ("changedTouches" in event && event.changedTouches && event.changedTouches.length > 0) {
    const touch = event.changedTouches[0];
    return { clientX: touch.clientX, clientY: touch.clientY };
  }
  if (
    "clientX" in event &&
    "clientY" in event &&
    typeof event.clientX === "number" &&
    typeof event.clientY === "number"
  ) {
    return { clientX: event.clientX, clientY: event.clientY };
  }
  return null;
}

export function usePanelDrag(config: {
  grids: PanelDragGrid[];
  getPanelGeometry: (panelId: string, containerIdx: number) => PanelGeometry;
  onTransfer?: (
    panelId: string,
    fromIdx: number,
    toIdx: number,
    newFromOrder: string[],
    newToOrder: string[],
  ) => void;
  onDragStateChange?: (dragging: boolean) => void;
}) {
  const configRef = useRef(config);
  const dragStateRef = useRef<DragRuntimeState>({
    activeId: null,
    sourceContainerIdx: -1,
    latestClientX: 0,
    latestClientY: 0,
    projectedVisibleOrders: null,
    lastTargetKey: "none",
  });
  const scrollCleanupRef = useRef<(() => void) | null>(null);
  const overlayPointerRef = useRef<OverlayPointerState>({
    active: false,
    startClientX: 0,
    startClientY: 0,
    originLeft: 0,
    originTop: 0,
    anchorX: OVERLAY_CURSOR_MIN_MARGIN_PX,
    anchorY: OVERLAY_CURSOR_MIN_MARGIN_PX,
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<PanelDragOverlayData | null>(null);
  const [projectedVisibleOrders, setProjectedVisibleOrders] = useState<string[][] | null>(null);
  const [disableTransforms, setDisableTransforms] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: DRAG_THRESHOLD },
    }),
  );
  const overlayModifiers = useMemo<Modifier[]>(() => [
    ({ transform }) => {
      const pointer = overlayPointerRef.current;
      if (!pointer.active) return transform;
      return {
        ...transform,
        x: pointer.startClientX + transform.x - pointer.originLeft - pointer.anchorX,
        y: pointer.startClientY + transform.y - pointer.originTop - pointer.anchorY,
      };
    },
  ], []);

  useEffect(() => {
    configRef.current = config;
  });

  const clearScrollListeners = useCallback(() => {
    scrollCleanupRef.current?.();
    scrollCleanupRef.current = null;
  }, []);

  const findPanelElement = useCallback((panelId: string) => {
    for (const grid of configRef.current.grids) {
      const container = grid.ref.current;
      if (!container) continue;
      const panel = Array.from(container.children).find(
        (child): child is HTMLElement =>
          child instanceof HTMLElement &&
          child.getAttribute("data-panel") === panelId,
      );
      if (panel) return panel;
    }
    return null;
  }, []);

  const buildOverlayData = useCallback((panelId: string, containerIdx: number) => {
    const geometry = configRef.current.getPanelGeometry(panelId, containerIdx);
    const panel = findPanelElement(panelId);
    const rect = panel?.getBoundingClientRect();
    const countText = panel?.querySelector(".panel-count")?.textContent?.trim() ?? "";
    const badgeText = panel?.querySelector(".panel-data-badge")?.textContent?.trim() ?? "";

    return {
      title: geometry.title,
      metaText: countText || badgeText || geometry.metaText || "",
      width: Math.max(220, Math.round(rect?.width ?? 320)),
      height: Math.max(140, Math.round(rect?.height ?? 220)),
    } satisfies PanelDragOverlayData;
  }, [findPanelElement]);

  const resolveDropTarget = useCallback((clientX: number, clientY: number): DropTarget | null => {
    const dragState = dragStateRef.current;
    if (!dragState.activeId || !dragState.projectedVisibleOrders) return null;
    const activePanelId = dragState.activeId;

    let containerTarget: DropTarget | null = null;
    let containerTargetScore = Number.POSITIVE_INFINITY;
    let nearestContainerTarget: DropTarget | null = null;
    let nearestContainerDistance = Number.POSITIVE_INFINITY;
    let globalTarget: DropTarget | null = null;
    let globalTargetScore = Number.POSITIVE_INFINITY;

    configRef.current.grids.forEach((grid, containerIdx) => {
      const container = grid.ref.current;
      if (!container) return;

      const metrics = buildContainerMetrics(container, grid.maxCols);
      const containerDistance = distanceToRect(clientX, clientY, metrics.rect);
      const pointerCell = getPointerGridCell(metrics, clientX, clientY);
      const items = dragState.projectedVisibleOrders?.[containerIdx]
        .filter((id) => id !== activePanelId)
        .map((id) => {
          const geometry = configRef.current.getPanelGeometry(id, containerIdx);
          return {
            id,
            colSpan: geometry.colSpan,
            rowSpan: geometry.rowSpan,
          } satisfies LayoutItem;
        }) ?? [];
      const dragGeometry = configRef.current.getPanelGeometry(activePanelId, containerIdx);
      const previewRects = buildPreviewRects(
        metrics,
        items,
        {
          id: activePanelId,
          colSpan: dragGeometry.colSpan,
          rowSpan: dragGeometry.rowSpan,
        },
        grid.maxCols,
      );

      let bestTargetInContainer: DropTarget | null = null;
      let bestTargetInContainerScore = Number.POSITIVE_INFINITY;
      let bestCellTargetInContainer: DropTarget | null = null;
      let bestCellTargetScore = Number.POSITIVE_INFINITY;

      previewRects.forEach((candidate) => {
        const score = scorePreviewRect(clientX, clientY, candidate.previewRect);
        if (score < globalTargetScore) {
          globalTargetScore = score;
          globalTarget = {
            containerIdx,
            insertIndex: candidate.insertIndex,
            previewRect: candidate.previewRect,
          };
        }
        if (score < bestTargetInContainerScore) {
          bestTargetInContainerScore = score;
          bestTargetInContainer = {
            containerIdx,
            insertIndex: candidate.insertIndex,
            previewRect: candidate.previewRect,
          };
        }
        if (candidateContainsCell(candidate, pointerCell.row, pointerCell.col)) {
          const cellScore = score + candidate.insertIndex * 0.001;
          if (cellScore < bestCellTargetScore) {
            bestCellTargetScore = cellScore;
            bestCellTargetInContainer = {
              containerIdx,
              insertIndex: candidate.insertIndex,
              previewRect: candidate.previewRect,
            };
          }
        }
        if (isPointInsideRect(metrics.rect, clientX, clientY, CONTAINER_EDGE_TOLERANCE_PX) && score < containerTargetScore) {
          containerTargetScore = score;
          containerTarget = bestCellTargetInContainer ?? {
            containerIdx,
            insertIndex: candidate.insertIndex,
            previewRect: candidate.previewRect,
          };
        }
      });

      if (
        bestCellTargetInContainer &&
        isPointInsideRect(metrics.rect, clientX, clientY, CONTAINER_EDGE_TOLERANCE_PX)
      ) {
        containerTargetScore = Math.min(containerTargetScore, bestCellTargetScore);
        containerTarget = bestCellTargetInContainer;
      }

      if (
        bestTargetInContainer &&
        containerDistance < nearestContainerDistance
      ) {
        nearestContainerDistance = containerDistance;
        nearestContainerTarget = bestCellTargetInContainer ?? bestTargetInContainer;
      }
    });

    if (containerTarget) return containerTarget;
    if (
      nearestContainerTarget &&
      nearestContainerDistance <= GLOBAL_TARGET_SNAP_DISTANCE_PX * GLOBAL_TARGET_SNAP_DISTANCE_PX
    ) {
      return nearestContainerTarget;
    }
    if (globalTarget && globalTargetScore <= GLOBAL_TARGET_SNAP_DISTANCE_PX * GLOBAL_TARGET_SNAP_DISTANCE_PX) {
      return globalTarget;
    }
    return null;
  }, []);

  const syncProjectedTarget = useCallback(() => {
    const dragState = dragStateRef.current;
    if (!dragState.activeId || !dragState.projectedVisibleOrders) return;

    const target = resolveDropTarget(dragState.latestClientX, dragState.latestClientY);
    if (!target) return;

    const nextKey = `${target.containerIdx}:${target.insertIndex}`;
    if (nextKey === dragState.lastTargetKey) return;

    const nextOrders = dragState.projectedVisibleOrders.map((order) =>
      order.filter((id) => id !== dragState.activeId),
    );
    nextOrders[target.containerIdx].splice(target.insertIndex, 0, dragState.activeId);

    dragState.lastTargetKey = nextKey;
    dragState.projectedVisibleOrders = nextOrders;
    setProjectedVisibleOrders(nextOrders);
  }, [resolveDropTarget]);

  const scheduledProjectedTargetRef = useRef<ReturnType<typeof rafSchedule> | null>(null);

  useEffect(() => {
    const scheduled = rafSchedule(syncProjectedTarget);
    scheduledProjectedTargetRef.current = scheduled;
    return () => {
      scheduled.cancel();
      scheduledProjectedTargetRef.current = null;
    };
  }, [syncProjectedTarget]);

  const attachScrollListeners = useCallback(() => {
    clearScrollListeners();
    const containers = configRef.current.grids
      .map((grid) => grid.ref.current)
      .filter((container): container is HTMLElement => Boolean(container));
    if (containers.length === 0) return;

    const handleScroll = () => {
      scheduledProjectedTargetRef.current?.();
    };

    containers.forEach((container) => {
      container.addEventListener("scroll", handleScroll, { passive: true });
    });

    scrollCleanupRef.current = () => {
      containers.forEach((container) => {
        container.removeEventListener("scroll", handleScroll);
      });
    };
  }, [clearScrollListeners]);

  const clearDragState = useCallback(() => {
    scheduledProjectedTargetRef.current?.cancel();
    clearScrollListeners();
    dragStateRef.current = {
      activeId: null,
      sourceContainerIdx: -1,
      latestClientX: 0,
      latestClientY: 0,
      projectedVisibleOrders: null,
      lastTargetKey: "none",
    };
    overlayPointerRef.current.active = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    document.body.classList.remove("panel-drag-active");
    setOverlay(null);
    setActiveId(null);
    setProjectedVisibleOrders(null);
    setDisableTransforms(false);
    configRef.current.onDragStateChange?.(false);
  }, [clearScrollListeners]);

  const commitProjectedOrders = useCallback(() => {
    const dragState = dragStateRef.current;
    if (!dragState.activeId || !dragState.projectedVisibleOrders) return;

    const activePanelId = dragState.activeId;
    const sourceContainerIdx = dragState.sourceContainerIdx;
    const targetContainerIdx = dragState.projectedVisibleOrders.findIndex((order) => order.includes(activePanelId));
    if (targetContainerIdx === -1) return;

    const sourceGrid = configRef.current.grids[sourceContainerIdx];
    const targetGrid = configRef.current.grids[targetContainerIdx];

    if (targetContainerIdx === sourceContainerIdx) {
      const newOrder = mergeVisibleOrder(sourceGrid.fullOrder, dragState.projectedVisibleOrders[sourceContainerIdx]);
      if (!arraysEqual(sourceGrid.fullOrder, newOrder)) {
        sourceGrid.onReorder(newOrder);
      }
      return;
    }

    const newFromOrder = mergeTransferredOrder(
      sourceGrid.fullOrder,
      dragState.projectedVisibleOrders[sourceContainerIdx],
      [activePanelId],
    );
    const newToOrder = mergeTransferredOrder(
      targetGrid.fullOrder,
      dragState.projectedVisibleOrders[targetContainerIdx],
    );

    if (
      arraysEqual(sourceGrid.fullOrder, newFromOrder) &&
      arraysEqual(targetGrid.fullOrder, newToOrder)
    ) {
      return;
    }

    if (configRef.current.onTransfer) {
      configRef.current.onTransfer(
        activePanelId,
        sourceContainerIdx,
        targetContainerIdx,
        newFromOrder,
        newToOrder,
      );
      return;
    }

    sourceGrid.onReorder(newFromOrder);
    targetGrid.onReorder(newToOrder);
  }, []);

  const onDragStart = useCallback((event: DragStartEvent) => {
    const panelId = String(event.active.id);
    const sourceContainerIdx = configRef.current.grids.findIndex((grid) => grid.visibleOrder.includes(panelId));
    if (sourceContainerIdx === -1) return;
    const sourceGeometry = configRef.current.getPanelGeometry(panelId, sourceContainerIdx);

    const panel = findPanelElement(panelId);
    const sourceRect = panel?.getBoundingClientRect();
    const point = readClientPoint(event.activatorEvent)
      ?? (sourceRect
        ? { clientX: sourceRect.left + 24, clientY: sourceRect.top + 20 }
        : { clientX: 0, clientY: 0 });

    const anchorX = sourceRect
      ? Math.max(
          OVERLAY_CURSOR_MIN_MARGIN_PX,
          Math.min(sourceRect.width - OVERLAY_CURSOR_MIN_MARGIN_PX, point.clientX - sourceRect.left),
        )
      : OVERLAY_CURSOR_MIN_MARGIN_PX;
    const anchorY = sourceRect
      ? Math.max(
          OVERLAY_CURSOR_MIN_MARGIN_PX,
          Math.min(sourceRect.height - OVERLAY_CURSOR_MIN_MARGIN_PX, point.clientY - sourceRect.top),
        )
      : OVERLAY_CURSOR_MIN_MARGIN_PX;

    overlayPointerRef.current = {
      active: true,
      startClientX: point.clientX,
      startClientY: point.clientY,
      originLeft: sourceRect?.left ?? point.clientX - anchorX,
      originTop: sourceRect?.top ?? point.clientY - anchorY,
      anchorX,
      anchorY,
    };

    const nextProjectedVisibleOrders = configRef.current.grids.map((grid) => [...grid.visibleOrder]);
    dragStateRef.current = {
      activeId: panelId,
      sourceContainerIdx,
      latestClientX: point.clientX,
      latestClientY: point.clientY,
      projectedVisibleOrders: nextProjectedVisibleOrders,
      lastTargetKey: `${sourceContainerIdx}:${nextProjectedVisibleOrders[sourceContainerIdx].indexOf(panelId)}`,
    };

    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    document.body.classList.add("panel-drag-active");
    configRef.current.onDragStateChange?.(true);

    setActiveId(panelId);
    setOverlay(buildOverlayData(panelId, sourceContainerIdx));
    setProjectedVisibleOrders(nextProjectedVisibleOrders);
    setDisableTransforms(sourceGeometry.colSpan > 1);
    attachScrollListeners();
  }, [attachScrollListeners, buildOverlayData, findPanelElement]);

  const onDragMove = useCallback((event: DragMoveEvent) => {
    if (!dragStateRef.current.activeId) return;
    dragStateRef.current.latestClientX = overlayPointerRef.current.startClientX + event.delta.x;
    dragStateRef.current.latestClientY = overlayPointerRef.current.startClientY + event.delta.y;
    scheduledProjectedTargetRef.current?.();
  }, []);

  const onDragEnd = useCallback((event: DragEndEvent) => {
    if (!dragStateRef.current.activeId) return;
    dragStateRef.current.latestClientX = overlayPointerRef.current.startClientX + event.delta.x;
    dragStateRef.current.latestClientY = overlayPointerRef.current.startClientY + event.delta.y;
    scheduledProjectedTargetRef.current?.cancel();
    syncProjectedTarget();
    commitProjectedOrders();
    clearDragState();
  }, [clearDragState, commitProjectedOrders, syncProjectedTarget]);

  const onDragCancel = useCallback(() => {
    if (!dragStateRef.current.activeId) return;
    clearDragState();
  }, [clearDragState]);

  useEffect(() => () => {
    clearDragState();
  }, [clearDragState]);

  return {
    sensors,
    overlay,
    overlayModifiers,
    activeId,
    isDragging: activeId !== null,
    disableTransforms,
    projectedVisibleOrders,
    onDragStart,
    onDragMove,
    onDragEnd,
    onDragCancel,
  };
}
