"use client";

import { useEffect, useRef, useState, useCallback } from "react";

type PlayerState = "loading" | "playing" | "buffering" | "error";

interface HLSPlayerProps {
  url: string;
  autoPlay?: boolean;
  /** Called when HLS fails fatally after retries */
  onFatalError?: () => void;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 4000, 8000]; // exponential backoff

export default function HLSPlayer({ url, autoPlay = true, onFatalError }: HLSPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [state, setState] = useState<PlayerState>("loading");

  const cleanup = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = undefined;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    retryCountRef.current = 0;
    setState("loading");

    let destroyed = false;

    async function initHls() {
      if (destroyed) return;

      // Clean up previous instance
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      // Native HLS (Safari / iOS)
      if (video!.canPlayType("application/vnd.apple.mpegurl")) {
        video!.src = url;
        video!.addEventListener("playing", () => setState("playing"), { once: true });
        video!.addEventListener("waiting", () => setState("buffering"));
        video!.addEventListener("error", () => {
          if (!destroyed) handleFatalError();
        }, { once: true });
        if (autoPlay) video!.play().catch(() => {});
        return;
      }

      // hls.js for other browsers
      try {
        const HlsModule = await import("hls.js");
        const Hls = HlsModule.default;

        if (!Hls.isSupported()) {
          setState("error");
          onFatalError?.();
          return;
        }

        if (destroyed) return;

        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          // More lenient settings for live streams
          manifestLoadingMaxRetry: 3,
          manifestLoadingRetryDelay: 1000,
          levelLoadingMaxRetry: 4,
          levelLoadingRetryDelay: 1000,
          fragLoadingMaxRetry: 4,
          fragLoadingRetryDelay: 1000,
          // Abort stuck loads
          manifestLoadingTimeOut: 10000,
          levelLoadingTimeOut: 10000,
          fragLoadingTimeOut: 20000,
        }) as unknown as {
          loadSource: (url: string) => void;
          attachMedia: (el: HTMLVideoElement) => void;
          on: (event: string, cb: (...args: unknown[]) => void) => void;
          destroy: () => void;
          recoverMediaError: () => void;
          startLoad: (startPosition?: number) => void;
        };

        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (autoPlay) video!.play().catch(() => {});
        });

        hls.on(Hls.Events.FRAG_LOADED, () => {
          if (!destroyed) {
            setState("playing");
            retryCountRef.current = 0; // reset on success
          }
        });

        // Distinguish fatal vs non-fatal errors
        hls.on(Hls.Events.ERROR, (...args: unknown[]) => {
          const data = (args[1] || {}) as { fatal?: boolean; type?: string; details?: string };
          if (destroyed) return;

          if (!data.fatal) {
            // Non-fatal: hls.js handles internally, just show buffering
            setState("buffering");
            return;
          }

          // Fatal error — try recovery strategies
          const errorType = data.type;

          if (errorType === "networkError") {
            // Network error: retry with backoff
            attemptRetry(hls);
          } else if (errorType === "mediaError") {
            // Media error: try recovery first
            try {
              hls.recoverMediaError();
              setState("buffering");
            } catch {
              attemptRetry(hls);
            }
          } else {
            // Other fatal errors (e.g., MUX_ERROR): direct fail
            handleFatalError();
          }
        });

        hls.loadSource(url);
        hls.attachMedia(video!);
      } catch {
        if (!destroyed) {
          setState("error");
          onFatalError?.();
        }
      }
    }

    function attemptRetry(hls: { startLoad: (startPosition?: number) => void }) {
      if (destroyed) return;

      const attempt = retryCountRef.current;
      if (attempt >= MAX_RETRIES) {
        handleFatalError();
        return;
      }

      retryCountRef.current = attempt + 1;
      setState("buffering");

      const delay = RETRY_DELAYS[attempt] || 8000;
      retryTimerRef.current = setTimeout(() => {
        if (destroyed) return;
        try {
          hls.startLoad(-1);
        } catch {
          // If startLoad fails, full reinit
          initHls();
        }
      }, delay);
    }

    function handleFatalError() {
      if (destroyed) return;
      setState("error");
      onFatalError?.();
    }

    // Video element events for native playback state
    const onPlaying = () => { if (!destroyed) setState("playing"); };
    const onWaiting = () => { if (!destroyed) setState("buffering"); };
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);

    initHls();

    return () => {
      destroyed = true;
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      cleanup();
    };
  }, [url, autoPlay, onFatalError, cleanup]);

  if (state === "error") {
    return (
      <div className="w-full aspect-video bg-[#111] border border-[#1e1e1e] flex items-center justify-center text-[12px] text-[#8a8a8a] font-mono">
        stream unavailable
      </div>
    );
  }

  return (
    <div className="relative w-full aspect-video bg-[#000]">
      <video
        ref={videoRef}
        muted
        playsInline
        controls
        className="w-full h-full"
      />
      {/* Loading / buffering overlay */}
      {(state === "loading" || state === "buffering") && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none">
          <div className="flex items-center gap-2">
            <svg className="animate-spin w-4 h-4 text-[#8a8a8a]" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="31.4 31.4" strokeLinecap="round" />
            </svg>
            <span className="text-[11px] text-[#8a8a8a] font-mono">
              {state === "loading" ? "connecting..." : "buffering..."}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
