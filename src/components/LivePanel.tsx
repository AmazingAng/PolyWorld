"use client";

import { useState, useCallback } from "react";
import { STREAMS, StreamSource } from "@/lib/streams";
import HLSPlayer from "./HLSPlayer";

type StreamMode = "hls" | "embed";

export default function LivePanel() {
  const [activeStream, setActiveStream] = useState<StreamSource | null>(null);
  const [mode, setMode] = useState<StreamMode>("hls");
  const [failedHls, setFailedHls] = useState<Set<string>>(new Set());

  const handleHlsFatal = useCallback(() => {
    if (!activeStream) return;
    // If this stream has a YouTube fallback, switch to it
    if (activeStream.ytEmbed) {
      setMode("embed");
      setFailedHls((prev) => new Set(prev).add(activeStream.hlsUrl));
    }
  }, [activeStream]);

  const selectStream = useCallback((stream: StreamSource) => {
    if (activeStream?.name === stream.name) {
      setActiveStream(null);
      return;
    }
    // If HLS previously failed for this stream and it has embed, go straight to embed
    if (failedHls.has(stream.hlsUrl) && stream.ytEmbed) {
      setMode("embed");
    } else {
      setMode("hls");
    }
    setActiveStream(stream);
  }, [activeStream, failedHls]);

  const toggleMode = useCallback(() => {
    setMode((m) => (m === "hls" ? "embed" : "hls"));
  }, []);

  return (
    <div className="font-mono">
      {/* Active player */}
      {activeStream ? (
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ff4444] animate-pulse" />
              <span className="text-[11px] text-[var(--text-secondary)]">{activeStream.name}</span>
              <span className="text-[11px] text-[var(--text-faint)]">{activeStream.region}</span>
            </div>
            <div className="flex items-center gap-1">
              {/* Mode toggle: HLS / Embed */}
              {activeStream.ytEmbed && (
                <button
                  onClick={toggleMode}
                  className={`text-[10px] px-1.5 py-0.5 border transition-colors font-mono ${
                    mode === "embed"
                      ? "border-[#f59e0b]/30 text-[#f59e0b]"
                      : "border-[var(--border-subtle)] text-[var(--text-faint)] hover:text-[var(--text-secondary)]"
                  }`}
                  title={mode === "hls" ? "Switch to YouTube embed" : "Switch to HLS stream"}
                >
                  {mode === "hls" ? "HLS" : "YT"}
                </button>
              )}
              <button
                onClick={() => setActiveStream(null)}
                className="text-[10px] text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors px-1.5 py-0.5 border border-[var(--border-subtle)]"
              >
                close
              </button>
            </div>
          </div>
          <div className="border border-[var(--border)] overflow-hidden">
            {mode === "embed" && activeStream.ytEmbed ? (
              <iframe
                src={activeStream.ytEmbed}
                className="w-full aspect-video"
                allow="autoplay; encrypted-media"
                allowFullScreen
                style={{ border: "none" }}
              />
            ) : (
              <HLSPlayer
                url={activeStream.hlsUrl}
                onFatalError={handleHlsFatal}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="mb-2 border border-[var(--border-subtle)] bg-[var(--bg)] flex items-center justify-center" style={{ height: 120 }}>
          <div className="text-center">
            <div className="text-[11px] text-[var(--text-faint)]">select a stream to watch</div>
          </div>
        </div>
      )}

      {/* Stream grid */}
      <div className="grid grid-cols-2 gap-1">
        {STREAMS.map((stream) => {
          const isActive = activeStream?.name === stream.name;
          const hlsFailed = failedHls.has(stream.hlsUrl);
          return (
            <button
              key={stream.name}
              onClick={() => selectStream(stream)}
              className={`text-left p-2 border transition-colors ${
                isActive
                  ? "border-[#22c55e]/30 bg-[#22c55e]/5"
                  : "border-[var(--border-subtle)] hover:bg-[var(--surface)]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-[11px] ${
                    isActive ? "text-[#22c55e]" : "text-[var(--text-secondary)]"
                  }`}
                >
                  {stream.name}
                </span>
                <div className="flex items-center gap-1">
                  {hlsFailed && stream.ytEmbed && (
                    <span className="text-[9px] text-[#f59e0b]" title="Using YouTube fallback">YT</span>
                  )}
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isActive ? "bg-[#22c55e] animate-pulse" : "bg-[var(--scrollbar-thumb)]"
                    }`}
                  />
                </div>
              </div>
              <div className="text-[10px] text-[var(--text-faint)]">{stream.region}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
