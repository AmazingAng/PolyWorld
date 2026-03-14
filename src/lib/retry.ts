/**
 * Fetch with exponential backoff retry.
 * Only retries on 5xx status codes and network errors.
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  maxRetries = 3,
  baseDelayMs = 1000,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);

      // Only retry on server errors (5xx)
      if (res.status >= 500 && attempt < maxRetries) {
        lastError = new Error(`HTTP ${res.status}`);
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Don't retry on abort (timeout)
      if (lastError.name === "AbortError") throw lastError;

      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError || new Error("fetchWithRetry exhausted retries");
}
