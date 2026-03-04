export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startSyncLoop } = await import("./lib/sync");
    startSyncLoop();
  }
}
