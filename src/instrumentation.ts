export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startSyncLoop } = await import("./lib/sync");
    startSyncLoop();
    const { startNewsSyncLoop } = await import("./lib/newsSync");
    startNewsSyncLoop();
    const { startSmartMoneySync } = await import("./lib/smartMoneySync");
    startSmartMoneySync();
  }
}
