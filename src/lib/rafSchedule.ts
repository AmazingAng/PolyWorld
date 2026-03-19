/**
 * Creates a RAF-throttled version of a callback.
 * At most one requestAnimationFrame is pending at any time.
 * Call .cancel() to cancel any pending frame.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rafSchedule<T extends (...args: any[]) => void>(
  callback: T,
): ((...args: Parameters<T>) => void) & { cancel: () => void } {
  let frameId = 0;
  let lastArgs: Parameters<T> | null = null;

  function scheduled(...args: Parameters<T>) {
    lastArgs = args;
    if (frameId) return;
    frameId = requestAnimationFrame(() => {
      frameId = 0;
      if (lastArgs) callback(...lastArgs);
    });
  }

  scheduled.cancel = () => {
    if (frameId) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }
    lastArgs = null;
  };

  return scheduled;
}
