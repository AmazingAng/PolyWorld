"use client";

import React, { useMemo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PanelDragHandleProps } from "@/components/panelDragTypes";

type DraggableChildProps = {
  dragRootRef?: React.Ref<HTMLDivElement>;
  dragHandleProps?: PanelDragHandleProps;
  dragStyle?: React.CSSProperties;
  dragClassName?: string;
};

interface DraggablePanelItemProps {
  id: string;
  disableTransforms?: boolean;
  children: React.ReactElement<DraggableChildProps> | null;
}

export default function DraggablePanelItem({ id, disableTransforms = false, children }: DraggablePanelItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const dragHandleProps = useMemo(
    () =>
      ({
        ref: setActivatorNodeRef,
        ...attributes,
        ...listeners,
      }) as PanelDragHandleProps,
    [attributes, listeners, setActivatorNodeRef],
  );

  const dragStyle = useMemo<React.CSSProperties>(
    () => {
      if (isDragging) {
        return {
          transition: "none",
          pointerEvents: "none",
        };
      }

      if (disableTransforms) {
        return {
          transition: "none",
        };
      }

      return {
        transform: CSS.Translate.toString(transform),
        transition: transition ?? "transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1)",
      };
    },
    [disableTransforms, isDragging, transform, transition],
  );

  const dragClassName = isDragging ? "panel-sortable panel-sortable-active" : "panel-sortable";

  if (!React.isValidElement<DraggableChildProps>(children)) {
    return children ?? null;
  }

  return React.cloneElement(children, {
    dragRootRef: setNodeRef,
    dragHandleProps,
    dragStyle,
    dragClassName,
  });
}
