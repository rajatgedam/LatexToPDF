/** Non-blocking concurrency limiter: overflow is rejected immediately instead of queued (no memory DoS). */
export function createLimiter(max) {
  let active = 0;
  return {
    tryAcquire() {
      if (active >= max) return null;
      active += 1;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          active -= 1;
        }
      };
    },
    get active() {
      return active;
    },
  };
}
