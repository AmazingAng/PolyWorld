"use client";

import { useEffect, useRef, useState } from "react";

interface HLSPlayerProps {
  url: string;
  autoPlay?: boolean;
}

export default function HLSPlayer({ url, autoPlay = true }: HLSPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let hls: { destroy: () => void } | null = null;

    async function init() {
      // Native HLS support (Safari)
      if (video!.canPlayType("application/vnd.apple.mpegurl")) {
        video!.src = url;
        if (autoPlay) video!.play().catch(() => {});
        return;
      }

      // Use hls.js for other browsers
      try {
        const HlsModule = await import("hls.js");
        const Hls = HlsModule.default;

        if (!Hls.isSupported()) {
          setError(true);
          return;
        }

        hls = new Hls({
          enableWorker: false,
          lowLatencyMode: true,
        });
        hlsRef.current = hls;

        (hls as unknown as { loadSource: (url: string) => void }).loadSource(url);
        (hls as unknown as { attachMedia: (el: HTMLVideoElement) => void }).attachMedia(video!);

        (hls as unknown as { on: (event: string, cb: () => void) => void }).on(
          Hls.Events.MANIFEST_PARSED,
          () => {
            if (autoPlay) video!.play().catch(() => {});
          }
        );

        (hls as unknown as { on: (event: string, cb: () => void) => void }).on(
          Hls.Events.ERROR,
          () => {
            setError(true);
          }
        );
      } catch {
        setError(true);
      }
    }

    init();

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [url, autoPlay]);

  if (error) {
    return (
      <div className="w-full aspect-video bg-[#111] border border-[#1e1e1e] flex items-center justify-center text-[12px] text-[#8a8a8a] font-mono">
        stream unavailable
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      muted
      playsInline
      controls
      className="w-full aspect-video bg-[#000] border border-[#1e1e1e]"
    />
  );
}
