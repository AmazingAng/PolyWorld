declare global {
  // Prevent duplicate background loops/listeners during Next dev HMR.
  var __polyworldRuntimeStarted: boolean | undefined;
  var __polyworldShutdownBound: boolean | undefined;
}

function validateEnv() {
  const required: [string, string][] = [];
  const optional: [string, string][] = [
    ["AI_API_KEY", "AI features (news matching, sentiment)"],
    ["NEWS_API_KEY", "News sync"],
    ["POLY_BUILDER_API_KEY", "CLOB trading"],
    ["POLY_BUILDER_SECRET", "CLOB trading"],
    ["POLY_BUILDER_PASSPHRASE", "CLOB trading"],
    ["POLYWORLD_ADMIN_KEY", "Admin endpoints"],
  ];
  const missing: string[] = [];
  for (const [key, label] of required) {
    if (!process.env[key]) missing.push(`  ${key} — ${label}`);
  }
  if (missing.length > 0) {
    throw new Error(
      `[PolyWorld] Missing required environment variables:\n${missing.join("\n")}\n\nCopy .env.example to .env.local and fill in the values.`,
    );
  }
  const warnings: string[] = [];
  for (const [key, label] of optional) {
    if (!process.env[key]) warnings.push(`  ${key} — ${label} (disabled)`);
  }
  if (warnings.length > 0) {
    console.warn(`[PolyWorld] Optional env vars not set:\n${warnings.join("\n")}`);
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (globalThis.__polyworldRuntimeStarted) {
      return;
    }

    validateEnv();

    const { startSyncLoop, stopSyncLoop } = await import("./lib/sync");
    startSyncLoop();
    const { startNewsSyncLoop, stopNewsSyncLoop } = await import("./lib/newsSync");
    startNewsSyncLoop();
    const { startSmartMoneySync, stopSmartMoneySync } = await import("./lib/smartMoneySync");
    startSmartMoneySync();
    const { startTweetsSyncLoop, stopTweetsSyncLoop } = await import("./lib/tweetsSync");
    startTweetsSyncLoop();
    const { startResolutionSyncLoop, stopResolutionSyncLoop } = await import("./lib/resolutionSync");
    startResolutionSyncLoop();
    globalThis.__polyworldRuntimeStarted = true;

    if (!globalThis.__polyworldShutdownBound) {
      const shutdown = async () => {
        console.info("[shutdown] Graceful shutdown initiated...");
        stopSyncLoop();
        stopNewsSyncLoop();
        stopSmartMoneySync();
        stopTweetsSyncLoop();
        stopResolutionSyncLoop();
        globalThis.__polyworldRuntimeStarted = false;

        const { closeDb } = await import("./lib/db");
        closeDb();

        console.info("[shutdown] Cleanup complete, exiting.");
        process.exit(0);
      };

      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);
      globalThis.__polyworldShutdownBound = true;
    }
  }
}
