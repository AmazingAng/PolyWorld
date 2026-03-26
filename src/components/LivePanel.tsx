"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { STREAMS, StreamSource } from "@/lib/streams";
import HLSPlayer from "./HLSPlayer";
import { useI18n } from "@/i18n";

type StreamMode = "hls" | "yt-hls" | "embed";
type CategoryTab = "news" | "sports";

interface LiveInfo {
  videoId: string | null;
  hlsUrl: string | null;
  loading: boolean;
}

const liveInfoCache = new Map<
  string,
  { videoId: string | null; hlsUrl: string | null; ts: number }
>();
const CACHE_TTL = 5 * 60 * 1000;

async function fetchLiveInfo(
  handle: string,
): Promise<{ videoId: string | null; hlsUrl: string | null }> {
  const cached = liveInfoCache.get(handle);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return { videoId: cached.videoId, hlsUrl: cached.hlsUrl };
  }
  try {
    const res = await fetch(
      `/api/youtube-live?channel=${encodeURIComponent(handle)}`,
    );
    if (!res.ok) throw new Error("API error");
    const data = await res.json();
    const result = { videoId: data.videoId || null, hlsUrl: data.hlsUrl || null };
    liveInfoCache.set(handle, { ...result, ts: Date.now() });
    return result;
  } catch {
    return { videoId: null, hlsUrl: null };
  }
}

/** Dropdown button for the Panel header — renders channel list inline */
export function LiveChannelDropdown({
  activeStream,
  onSelect,
}: {
  activeStream: StreamSource | null;
  onSelect: (stream: StreamSource | null) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<CategoryTab>("news");
  const ref = useRef<HTMLDivElement>(null);

  const filteredStreams = useMemo(
    () => STREAMS.filter((s) => s.category === tab),
    [tab],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative font-mono">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 text-[10px] px-1.5 py-0.5 border transition-colors ${
          open || activeStream
            ? "border-[var(--text-secondary)]/30 text-[var(--text-secondary)]"
            : "border-[var(--border-subtle)] text-[var(--text-faint)] hover:text-[var(--text-secondary)]"
        }`}
      >
        {activeStream ? (
          <>
            <span className="w-1 h-1 rounded-full bg-[#22c55e] animate-pulse shrink-0" />
            <span className="max-w-[90px] truncate">{activeStream.name}</span>
          </>
        ) : (
          <>{t("livePanel.channelMenu")}</>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-0.5 z-[9999] bg-[var(--bg)] border border-[var(--border)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] min-w-[180px]">
          {/* Category tabs */}
          <div className="flex border-b border-[var(--border-subtle)]">
            {(["news", "sports"] as const).map((tabKey) => (
              <button
                key={tabKey}
                onClick={() => setTab(tabKey)}
                className={`flex-1 text-[10px] uppercase tracking-wide px-2 py-1.5 font-mono transition-colors ${
                  tab === tabKey
                    ? "text-[var(--text-secondary)] bg-[var(--surface)]"
                    : "text-[var(--text-faint)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {t(tabKey === "news" ? "livePanel.newsTab" : "livePanel.sportsTab")}
              </button>
            ))}
          </div>

          {/* Stream list */}
          <div className="py-0.5">
            {activeStream && (
              <button
                onClick={() => { onSelect(null); setOpen(false); }}
                className="w-full text-left px-2.5 py-1.5 text-[10px] text-[#ff6666] hover:bg-[var(--surface-hover)] font-mono border-b border-[var(--border-subtle)] mb-0.5"
              >
                {t("livePanel.stopStream")}
              </button>
            )}
            {filteredStreams.map((stream) => {
              const isActive = activeStream?.id === stream.id;
              return (
                <button
                  key={stream.id}
                  onClick={() => { onSelect(isActive ? null : stream); if (!isActive) setOpen(false); }}
                  className={`w-full text-left px-2.5 py-1.5 hover:bg-[var(--surface-hover)] transition-colors ${
                    isActive ? "bg-[#22c55e]/5" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-[10px] font-mono truncate ${
                        isActive ? "text-[#22c55e]" : "text-[var(--text-secondary)]"
                      }`}
                    >
                      {stream.name}
                    </span>
                    {isActive && (
                      <span className="w-1 h-1 rounded-full bg-[#22c55e] animate-pulse shrink-0" />
                    )}
                  </div>
                  <div className="text-[10px] text-[var(--text-faint)]">
                    {stream.region}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

interface LivePanelProps {
  activeStream?: StreamSource | null;
}

export default function LivePanel({ activeStream = null }: LivePanelProps) {
  const { t } = useI18n();
  if (!activeStream) {
    return (
      <div
        className="w-full bg-[var(--bg)] border border-[var(--border-subtle)] flex items-center justify-center font-mono"
        style={{ aspectRatio: "16/9" }}
      >
        <span className="text-[11px] text-[var(--text-faint)]">
          {t("livePanel.selectChannel")}
        </span>
      </div>
    );
  }

  return <LivePanelContent key={activeStream.id} activeStream={activeStream} />;
}

function LivePanelContent({ activeStream }: { activeStream: StreamSource }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<StreamMode>("hls");
  const [liveInfo, setLiveInfo] = useState<LiveInfo>({
    videoId: null,
    hlsUrl: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    const loadInfo = async () => {
      const info = await fetchLiveInfo(activeStream.handle);
      if (cancelled) return;
      setLiveInfo({ ...info, loading: false });
      if (activeStream.hlsUrl) setMode("hls");
      else if (info.hlsUrl) setMode("yt-hls");
      else setMode("embed");
    };

    void loadInfo();

    return () => { cancelled = true; };
  }, [activeStream]);

  const handleHlsFatal = useCallback(() => {
    if (mode === "hls" && liveInfo.hlsUrl) setMode("yt-hls");
    else setMode("embed");
  }, [mode, liveInfo.hlsUrl]);

  const ytEmbedUrl = useMemo(() => {
    if (!activeStream) return null;
    const vid = liveInfo.videoId || activeStream.fallbackVideoId;
    if (!vid) return null;
    return `https://www.youtube.com/embed/${vid}?autoplay=1&mute=1`;
  }, [activeStream, liveInfo.videoId]);

  return (
    <div className="border border-[var(--border)] overflow-hidden">
        {liveInfo.loading ? (
          <div className="w-full aspect-video bg-[#000] flex items-center justify-center">
            <div className="flex items-center gap-2">
              <svg
                className="animate-spin w-4 h-4 text-[#8a8a8a]"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray="31.4 31.4"
                  strokeLinecap="round"
                />
              </svg>
              <span className="text-[11px] text-[#8a8a8a] font-mono">
                {t("chart.detectingStream")}
              </span>
            </div>
          </div>
        ) : mode === "embed" && ytEmbedUrl ? (
          <iframe
            src={ytEmbedUrl}
            className="w-full aspect-video"
            allow="autoplay; encrypted-media"
            allowFullScreen
            style={{ border: "none" }}
          />
        ) : mode === "yt-hls" && liveInfo.hlsUrl ? (
          <HLSPlayer
            url={liveInfo.hlsUrl}
            onFatalError={() => setMode("embed")}
          />
        ) : mode === "hls" && activeStream.hlsUrl ? (
          <HLSPlayer url={activeStream.hlsUrl} onFatalError={handleHlsFatal} />
        ) : ytEmbedUrl ? (
          <iframe
            src={ytEmbedUrl}
            className="w-full aspect-video"
            allow="autoplay; encrypted-media"
            allowFullScreen
            style={{ border: "none" }}
          />
        ) : (
          <div className="w-full aspect-video bg-[var(--bg)] flex items-center justify-center">
            <span className="text-[11px] text-[var(--text-faint)]">
              {t("livePanel.noStream")}
            </span>
          </div>
        )}
    </div>
  );
}
