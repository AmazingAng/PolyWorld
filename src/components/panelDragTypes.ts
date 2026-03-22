"use client";

import type React from "react";

export type PanelDragHandleProps = React.HTMLAttributes<HTMLElement> &
  React.AriaAttributes & {
    ref?: React.Ref<HTMLElement>;
  };
