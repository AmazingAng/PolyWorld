import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3001",
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "npx next start -p 3001",
    port: 3001,
    reuseExistingServer: true,
  },
});
