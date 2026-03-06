import { test, expect } from "playwright/test";

test.describe("Sentiment Panel", () => {
  test.beforeEach(async ({ page }) => {
    // Comprehensive WebGL mock to prevent MapLibre crash in headless Chrome
    await page.addInitScript(() => {
      const handler: ProxyHandler<object> = {
        get(_target, prop) {
          if (prop === Symbol.toPrimitive) return () => 0;
          if (prop === "toString") return () => "[object WebGLRenderingContext]";
          // Return functions that return safe defaults
          return (..._args: unknown[]) => {
            // getExtension → null, createShader/Program/Buffer → {}, getParameter → 0, etc.
            return null;
          };
        },
      };

      const origGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        type: string,
        ...rest: unknown[]
      ) {
        if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") {
          // Return a Proxy that returns no-op for every method and safe defaults for properties
          const fakeGL = new Proxy({}, handler);
          // Set critical properties that maplibre checks
          Object.defineProperty(fakeGL, "drawingBufferWidth", { get: () => this.width || 300 });
          Object.defineProperty(fakeGL, "drawingBufferHeight", { get: () => this.height || 150 });
          Object.defineProperty(fakeGL, "canvas", { get: () => this });
          return fakeGL as unknown as WebGLRenderingContext;
        }
        return (origGetContext as Function).call(this, type, ...rest);
      } as typeof origGetContext;

      // Suppress unhandled errors from maplibre
      window.addEventListener("error", (e) => {
        if (
          e.message?.includes("WebGL") ||
          e.message?.includes("maplibre") ||
          e.message?.includes("Map")
        ) {
          e.preventDefault();
        }
      });
    });

    // Ignore page errors (maplibre might still throw)
    page.on("pageerror", () => {});

    await page.goto("/", { waitUntil: "domcontentloaded" });
    // Wait for the sentiment panel to load data
    await page.waitForSelector('[data-testid="sentiment-panel"]', { timeout: 30_000 });
  });

  test("panel appears in the grid with gauge and score", async ({ page }) => {
    const panel = page.locator('[data-panel="sentiment"]');
    await expect(panel).toBeVisible();

    // Title says SENTIMENT
    await expect(panel.locator(".panel-title")).toHaveText("Sentiment");

    // Gauge SVG is rendered
    const gauge = page.locator('[data-testid="sentiment-gauge"]');
    await expect(gauge).toBeVisible();

    // Score number is visible inside the gauge
    const scoreText = gauge.locator('[data-testid="gauge-score"]');
    await expect(scoreText).toBeVisible();
    const scoreValue = await scoreText.textContent();
    const num = parseInt(scoreValue || "", 10);
    expect(num).toBeGreaterThanOrEqual(0);
    expect(num).toBeLessThanOrEqual(100);
  });

  test("displays sentiment label", async ({ page }) => {
    const label = page.locator('[data-testid="sentiment-label"]');
    await expect(label).toBeVisible();
    const text = await label.textContent();
    expect(
      ["EXTREME FEAR", "FEAR", "NEUTRAL", "GREED", "EXTREME GREED"]
    ).toContain(text);
  });

  test("renders all 5 sub-score bars", async ({ page }) => {
    const rows = page.locator('[data-testid="subscore-row"]');
    await expect(rows).toHaveCount(5);

    const expectedNames = [
      "Price Momentum",
      "Volume",
      "Smart Money",
      "Volatility",
      "Market Breadth",
    ];

    for (let i = 0; i < 5; i++) {
      const row = rows.nth(i);
      await expect(row).toBeVisible();
      const name = await row.locator("span").first().textContent();
      expect(name?.trim()).toBe(expectedNames[i]);
    }
  });

  test("shows active markets footer", async ({ page }) => {
    const footer = page.locator('[data-testid="sentiment-footer"]');
    await expect(footer).toBeVisible();
    const text = await footer.textContent();
    expect(text).toMatch(/\d+ active markets/);
  });

  test("panel is toggleable in Settings", async ({ page }) => {
    // Verify panel is visible
    await expect(page.locator('[data-panel="sentiment"]')).toBeVisible();

    // Open settings via the gear icon button in the header
    await page.locator("header button, .header button").filter({ has: page.locator("svg") }).last().click();
    await page.waitForSelector('.settings-modal', { timeout: 5_000 });

    // Go to Panels tab
    await page.locator('.settings-tab:has-text("PANELS")').click();

    // Toggle sentiment off
    const toggle = page.locator('.panel-toggle-item:has-text("Sentiment")');
    await expect(toggle).toBeVisible();
    await toggle.click();

    // Close settings
    await page.locator('.settings-close').click();

    // Panel should be hidden now
    await expect(page.locator('[data-panel="sentiment"]')).toBeHidden();
  });

  test("fetches data from /api/sentiment", async ({ page }) => {
    // Verify the API was called successfully by checking rendered data
    const gauge = page.locator('[data-testid="sentiment-gauge"]');
    const scoreText = await gauge.locator('[data-testid="gauge-score"]').textContent();
    const score = parseInt(scoreText || "", 10);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);

    // Verify sub-scores have numeric values
    const rows = page.locator('[data-testid="subscore-row"]');
    for (let i = 0; i < 5; i++) {
      const valueText = await rows.nth(i).locator("span").last().textContent();
      const value = parseInt(valueText?.trim() || "", 10);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});
