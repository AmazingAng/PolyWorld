"use client";

import React from "react";

interface Props {
  children: React.ReactNode;
  panelName?: string;
}

interface State {
  hasError: boolean;
}

export default class PanelErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[PanelErrorBoundary] ${this.props.panelName || "panel"} crashed:`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 p-4 text-center font-mono" style={{ minHeight: 80 }}>
          <span className="text-[11px] text-[var(--text-muted)]">panel error</span>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="px-3 py-1 text-[10px] rounded border transition-colors"
            style={{
              borderColor: "var(--border)",
              color: "var(--text-secondary)",
              background: "var(--panel-bg)",
            }}
          >
            retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
