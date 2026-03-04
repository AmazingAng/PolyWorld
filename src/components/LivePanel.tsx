"use client";

import { useState } from "react";
import { STREAMS, StreamSource } from "@/lib/streams";
import HLSPlayer from "./HLSPlayer";

export default function LivePanel() {
  const [activeStream, setActiveStream] = useState<StreamSource | null>(null);

  return (
    <div className="font-mono">
      {/* Active player — large, prominent */}
      {activeStream ? (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ff4444] animate-pulse" />
              <span className="text-[13px] text-[var(--text-secondary)]">{activeStream.name}</span>
              <span className="text-[13px] text-[var(--text-faint)]">{activeStream.region}</span>
            </div>
            <button
              onClick={() => setActiveStream(null)}
              className="text-[13px] text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors px-1.5 py-0.5 border border-[var(--border-subtle)]"
            >
              close
            </button>
          </div>
          <div className="border border-[var(--border)] overflow-hidden">
            <HLSPlayer url={activeStream.hlsUrl} />
          </div>
        </div>
      ) : (
        <div className="mb-3 border border-[var(--border-subtle)] bg-[var(--bg)] flex items-center justify-center" style={{ height: 160 }}>
          <div className="text-center">
            <div className="text-[12px] text-[var(--text-faint)]">select a stream to watch</div>
          </div>
        </div>
      )}

      {/* Stream grid */}
      <div className="grid grid-cols-2 gap-1">
        {STREAMS.map((stream) => {
          const isActive = activeStream?.name === stream.name;
          return (
            <button
              key={stream.name}
              onClick={() => setActiveStream(isActive ? null : stream)}
              className={`text-left px-2 py-1.5 border transition-colors ${
                isActive
                  ? "border-[#22c55e]/30 bg-[#22c55e]/5"
                  : "border-[var(--border-subtle)] hover:bg-[var(--surface)]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-[12px] ${
                    isActive ? "text-[#22c55e]" : "text-[var(--text-secondary)]"
                  }`}
                >
                  {stream.name}
                </span>
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isActive ? "bg-[#22c55e] animate-pulse" : "bg-[var(--scrollbar-thumb)]"
                  }`}
                />
              </div>
              <div className="text-[13px] text-[var(--text-faint)]">{stream.region}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
