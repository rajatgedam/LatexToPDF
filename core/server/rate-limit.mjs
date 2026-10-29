/** Token bucket per key: `perMin` burst, refilled continuously; bounded memory. */
export function createRateLimiter({ perMin, now = Date.now, maxKeys = 10_000 }) {
  const buckets = new Map();
  const refillPerMs = perMin / 60_000;

  function prune(t) {
    for (const [k, b] of buckets) if (Math.min(perMin, b.tokens + (t - b.at) * refillPerMs) >= perMin) buckets.delete(k);
    while (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value);
  }

  return {
    take(key) {
      const t = now();
      let b = buckets.get(key);
      if (!b) {
        if (buckets.size >= maxKeys) prune(t);
        b = { tokens: perMin, at: t };
        buckets.set(key, b);
      }
      b.tokens = Math.min(perMin, b.tokens + (t - b.at) * refillPerMs);
      b.at = t;
      if (b.tokens >= 1) {
        b.tokens -= 1;
        return { ok: true };
      }
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - b.tokens) / refillPerMs / 1000)) };
    },
    get size() {
      return buckets.size;
    },
  };
}
