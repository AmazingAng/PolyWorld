import { NextRequest, NextResponse } from "next/server";

/**
 * Scrapes YouTube /@channel/live to extract current live video ID + HLS manifest.
 * Caches results for 5 minutes.
 * GET /api/youtube-live?channel=@SkyNews
 */

interface CacheEntry {
  videoId: string | null;
  hlsUrl: string | null;
  channelName: string | null;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function GET(request: NextRequest) {
  const channel = request.nextUrl.searchParams.get("channel");
  if (!channel || !/^@?[\w.-]{1,50}$/.test(channel)) {
    return NextResponse.json(
      { error: "Missing or invalid channel parameter" },
      { status: 400 },
    );
  }

  const handle = channel.startsWith("@") ? channel : `@${channel}`;

  // Check cache
  const cached = cache.get(handle);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json(
      {
        videoId: cached.videoId,
        hlsUrl: cached.hlsUrl,
        channelName: cached.channelName,
        isLive: cached.videoId !== null,
        cached: true,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=300, s-maxage=300",
        },
      },
    );
  }

  try {
    const response = await fetch(`https://www.youtube.com/${handle}/live`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return NextResponse.json({
        videoId: null,
        hlsUrl: null,
        channelName: null,
        isLive: false,
        channelExists: false,
      });
    }

    const html = await response.text();

    // Extract channel name
    let channelName: string | null = null;
    const ownerMatch = html.match(/"ownerChannelName"\s*:\s*"([^"]+)"/);
    if (ownerMatch) {
      channelName = ownerMatch[1];
    } else {
      const authorMatch = html.match(/"author"\s*:\s*"([^"]+)"/);
      if (authorMatch) channelName = authorMatch[1];
    }

    // Extract video ID from videoDetails (only if live)
    let videoId: string | null = null;
    const detailsIdx = html.indexOf('"videoDetails"');
    if (detailsIdx !== -1) {
      const block = html.substring(detailsIdx, detailsIdx + 5000);
      const vidMatch = block.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
      const liveMatch = block.match(/"isLive"\s*:\s*true/);
      if (vidMatch && liveMatch) {
        videoId = vidMatch[1];
      }
    }

    // Extract HLS manifest URL
    let hlsUrl: string | null = null;
    const hlsMatch = html.match(/"hlsManifestUrl"\s*:\s*"([^"]+)"/);
    if (hlsMatch && videoId) {
      hlsUrl = hlsMatch[1].replace(/\\u0026/g, "&");
    }

    // Cache result
    cache.set(handle, {
      videoId,
      hlsUrl,
      channelName,
      timestamp: Date.now(),
    });

    return NextResponse.json(
      {
        videoId,
        hlsUrl,
        channelName,
        isLive: videoId !== null,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=300, s-maxage=300",
        },
      },
    );
  } catch (err) {
    console.error(`[youtube-live] Failed to fetch ${handle}:`, err);
    return NextResponse.json({
      videoId: null,
      hlsUrl: null,
      channelName: null,
      isLive: false,
      error: "Failed to fetch channel data",
    });
  }
}
