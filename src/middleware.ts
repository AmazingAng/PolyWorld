import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Admin Auth
// ---------------------------------------------------------------------------
const ADMIN_KEY = process.env.POLYWORLD_ADMIN_KEY;

const ADMIN_ROUTES: Record<string, Set<string>> = {
  "/api/sync": new Set(["POST"]),
  "/api/geo-enhance": new Set(["POST"]),
};

function requiresAuth(pathname: string, method: string): boolean {
  const methods = ADMIN_ROUTES[pathname];
  return !!methods && methods.has(method);
}

function isAuthorized(req: NextRequest): boolean {
  if (!ADMIN_KEY) return false;
  const header = req.headers.get("authorization");
  if (!header) return false;
  const [scheme, token] = header.split(" ", 2);
  return scheme === "Bearer" && token === ADMIN_KEY;
}

// ---------------------------------------------------------------------------
// Rate Limiting (in-memory fixed-window counter)
// ---------------------------------------------------------------------------
interface RateBucket {
  count: number;
  resetAt: number;
}

const rateMaps = {
  ai: new Map<string, RateBucket>(),
  read: new Map<string, RateBucket>(),
  admin: new Map<string, RateBucket>(),
  balance: new Map<string, RateBucket>(),
};

const RATE_LIMITS: Record<keyof typeof rateMaps, { max: number; windowMs: number }> = {
  ai: { max: 6, windowMs: 60_000 },
  read: { max: 300, windowMs: 60_000 },
  admin: { max: 10, windowMs: 60_000 },
  balance: { max: 30, windowMs: 60_000 },
};

// Periodic cleanup of expired entries every 5 minutes
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 5 * 60_000;

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const map of Object.values(rateMaps)) {
    for (const [key, bucket] of map) {
      if (now >= bucket.resetAt) map.delete(key);
    }
  }
}

function getTier(pathname: string): keyof typeof rateMaps {
  if (pathname === "/api/summarize") return "ai";
  if (pathname === "/api/sync" || pathname === "/api/geo-enhance") return "admin";
  if (pathname === "/api/trade/balance") return "balance";
  return "read";
}

function getClientIP(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function checkRateLimit(
  ip: string,
  tier: keyof typeof rateMaps
): { allowed: boolean; retryAfter: number; limit: number; remaining: number; resetAt: number } {
  cleanup();

  const { max, windowMs } = RATE_LIMITS[tier];
  const map = rateMaps[tier];
  const now = Date.now();

  let bucket = map.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    map.set(ip, bucket);
  }

  bucket.count++;
  const remaining = Math.max(0, max - bucket.count);
  const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);

  return {
    allowed: bucket.count <= max,
    retryAfter,
    limit: max,
    remaining,
    resetAt: bucket.resetAt,
  };
}

// ---------------------------------------------------------------------------
// Security Headers
// ---------------------------------------------------------------------------
function buildCsp(): string {
  const isDev = process.env.NODE_ENV !== "production";
  // Production Next.js still emits small inline bootstraps; Cloudflare proxy injects Insights.
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com";

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https: http:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://gamma-api.polymarket.com https://data-api.polymarket.com https://clob.polymarket.com https://*.publicnode.com https://polygon-rpc.com https://1rpc.io https://rpc.ankr.com https://*.zan.top https://*.basemaps.cartocdn.com https://basemaps.cartocdn.com https://cdn.jsdelivr.net https://manifest.googlevideo.com https://*.googlevideo.com",
    "media-src 'self' blob: https://*.googlevideo.com https://*.akamaized.net https://*.amagi.tv https://*.trt.com.tr https://*.nhkworld.jp",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
    "frame-ancestors 'none'",
  ].join("; ");
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Content-Security-Policy": buildCsp(),
};

function applySecurityHeaders(response: NextResponse): void {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method;

  // --- Admin auth check ---
  if (requiresAuth(pathname, method)) {
    if (!isAuthorized(req)) {
      const res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      applySecurityHeaders(res);
      return res;
    }
  }

  // --- Rate limiting (API routes only, exempt health check) ---
  if (pathname.startsWith("/api/") && pathname !== "/api/health") {
    const ip = getClientIP(req);
    const tier = getTier(pathname);
    const rl = checkRateLimit(ip, tier);

    if (!rl.allowed) {
      const res = NextResponse.json(
        { error: "Too many requests" },
        { status: 429 }
      );
      res.headers.set("Retry-After", String(rl.retryAfter));
      res.headers.set("X-RateLimit-Limit", String(rl.limit));
      res.headers.set("X-RateLimit-Remaining", "0");
      res.headers.set("X-RateLimit-Reset", String(Math.ceil(rl.resetAt / 1000)));
      applySecurityHeaders(res);
      return res;
    }

    // Continue with rate limit headers on success
    const res = NextResponse.next();
    res.headers.set("X-RateLimit-Limit", String(rl.limit));
    res.headers.set("X-RateLimit-Remaining", String(rl.remaining));
    res.headers.set("X-RateLimit-Reset", String(Math.ceil(rl.resetAt / 1000)));
    applySecurityHeaders(res);
    return res;
  }

  // --- Non-API routes: just add security headers ---
  const res = NextResponse.next();
  applySecurityHeaders(res);
  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|txt|xml)$).*)",
  ],
};
