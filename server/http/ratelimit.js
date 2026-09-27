/** Fixed-window in-memory limiter. Swap for Redis or similar when running more than one instance. */
export function createLimiter({ windowMs, max }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs);
  sweep.unref();

  return {
    /** Returns true when the request is allowed. */
    take(key) {
      const now = Date.now();
      let e = hits.get(key);
      if (!e || e.reset <= now) { e = { n: 0, reset: now + windowMs }; hits.set(key, e); }
      e.n += 1;
      return e.n <= max;
    },
    clear(key) { hits.delete(key); },
  };
}
