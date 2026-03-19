/**
 * Simple circuit breaker for API calls.
 * After `threshold` consecutive failures, enters OPEN state for `cooldownMs`.
 * During cooldown, `call()` returns the fallback value immediately.
 */
export class CircuitBreaker<T> {
  private failures = 0;
  private openUntil = 0;

  constructor(
    private readonly name: string,
    private readonly threshold: number = 5,
    private readonly cooldownMs: number = 60_000,
  ) {}

  async call(fn: () => Promise<T>, fallback: T): Promise<T> {
    if (this.isOpen()) {
      console.warn(`[circuitBreaker:${this.name}] OPEN — skipping call (${Math.ceil((this.openUntil - Date.now()) / 1000)}s remaining)`);
      return fallback;
    }

    try {
      const result = await fn();
      this.failures = 0;
      return result;
    } catch (err) {
      this.failures++;
      if (this.failures >= this.threshold) {
        this.openUntil = Date.now() + this.cooldownMs;
        console.warn(`[circuitBreaker:${this.name}] OPENED after ${this.failures} failures — cooldown ${this.cooldownMs / 1000}s`);
      }
      throw err;
    }
  }

  isOpen(): boolean {
    if (Date.now() >= this.openUntil) {
      if (this.openUntil > 0) {
        // Half-open: reset and allow one attempt
        this.openUntil = 0;
        this.failures = 0;
      }
      return false;
    }
    return true;
  }

  reset(): void {
    this.failures = 0;
    this.openUntil = 0;
  }
}
