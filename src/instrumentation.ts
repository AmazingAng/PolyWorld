export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
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

    const shutdown = async () => {
      console.info("[shutdown] Graceful shutdown initiated...");
      stopSyncLoop();
      stopNewsSyncLoop();
      stopSmartMoneySync();
      stopTweetsSyncLoop();
      stopResolutionSyncLoop();

      const { closeDb } = await import("./lib/db");
      closeDb();

      console.info("[shutdown] Cleanup complete, exiting.");
      process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }
}
