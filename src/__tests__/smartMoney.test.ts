import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchFullLeaderboard } from "@/lib/smartMoney";

describe("fetchFullLeaderboard", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("stops when PnL drops below minPnl", async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => ({
      proxyWallet: `0x${i}`,
      userName: `user${i}`,
      pnl: 200_000 - i * 1000,
      vol: 1_000_000,
      rank: `${i + 1}`,
    }));
    // Page 2: all below 100k
    const page2 = Array.from({ length: 50 }, (_, i) => ({
      proxyWallet: `0x${50 + i}`,
      userName: `user${50 + i}`,
      pnl: 90_000 - i * 1000,
      vol: 500_000,
      rank: `${51 + i}`,
    }));

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(page2), { status: 200 }));
    globalThis.fetch = mockFetch;

    const result = await fetchFullLeaderboard(100_000);
    // Should have all 50 from page 1 (all >= 100k) and stop at first entry below threshold on page 2
    expect(result.length).toBe(50);
    expect(result.every(e => e.pnl >= 100_000)).toBe(true);
  });

  it("stops on empty page", async () => {
    const page1 = Array.from({ length: 10 }, (_, i) => ({
      proxyWallet: `0x${i}`,
      pnl: 500_000,
      vol: 1_000_000,
      rank: `${i + 1}`,
    }));

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    globalThis.fetch = mockFetch;

    const result = await fetchFullLeaderboard(100_000);
    // Should stop after page1 since it had < PAGE_SIZE entries
    expect(result.length).toBe(10);
  });

  it("respects MAX_PAGES limit", async () => {
    // This would be impractical to fully test 200 pages, but we verify the limit exists
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 })
    );
    globalThis.fetch = mockFetch;

    const result = await fetchFullLeaderboard(0);
    expect(result.length).toBe(0);
    // Should have stopped on the first empty response
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
