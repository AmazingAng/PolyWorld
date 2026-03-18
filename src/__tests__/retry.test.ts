import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWithRetry } from "@/lib/retry";

describe("fetchWithRetry", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns response on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const res = await fetchWithRetry("https://example.com");
    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries on 500 error", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(new Response("error", { status: 500 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    globalThis.fetch = mockFetch;

    const res = await fetchWithRetry("https://example.com", undefined, 3, 10);
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 4xx errors", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    const res = await fetchWithRetry("https://example.com", undefined, 3, 10);
    expect(res.status).toBe(404);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries on network error", async () => {
    const mockFetch = vi.fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    globalThis.fetch = mockFetch;

    const res = await fetchWithRetry("https://example.com", undefined, 3, 10);
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error"));
    await expect(fetchWithRetry("https://example.com", undefined, 2, 10))
      .rejects.toThrow("network error");
    expect(globalThis.fetch).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("does not retry on AbortError", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    globalThis.fetch = vi.fn().mockRejectedValue(abortError);
    await expect(fetchWithRetry("https://example.com", undefined, 3, 10))
      .rejects.toThrow("aborted");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
