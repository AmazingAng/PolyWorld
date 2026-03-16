/**
 * Sync interval configuration.
 *
 * In development (npm run dev), all intervals are slowed down dramatically to
 * avoid hammering Polymarket APIs during local work.
 *
 * Override: set FAST_SYNC=1 in .env.local to use production intervals in dev.
 */

const isDev =
  process.env.NODE_ENV === "development" && process.env.FAST_SYNC !== "1";

if (isDev) {
  console.info(
    "[sync] DEV slow-mode active — reduced polling intervals. Set FAST_SYNC=1 in .env.local to disable."
  );
}

export const MARKET_SYNC_MS      = isDev ?  10 * 60_000 :      30_000; // 10 min  / 30 s
export const NEWS_SYNC_MS        = isDev ?  60 * 60_000 : 5 * 60_000;  // 60 min  / 5 min
export const TWEETS_SYNC_MS      = isDev ?  60 * 60_000 : 3 * 60_000;  // 60 min  / 3 min
export const RESOLUTION_SYNC_MS  = isDev ?  30 * 60_000 : 2 * 60_000;  // 30 min  / 2 min
export const SMART_MONEY_MS      = isDev ?  30 * 60_000 : 5 * 60_000;  // 30 min  / 5 min
export const LEADERBOARD_MS      = isDev ? 24 * 60 * 60_000 : 60 * 60_000; // 24 h / 1 h
