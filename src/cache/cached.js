import { redis } from "../redis.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cache-aside helper with a short NX/EX lock to prevent cache stampedes.
 *
 * @template T
 * @param {string} key Redis cache key.
 * @param {number} ttl Cache TTL in seconds.
 * @param {() => Promise<T>} fetcher Function called on a cache miss.
 * @returns {Promise<T>}
 */
export async function cached(key, ttl, fetcher) {
  const hit = await redis.get(key);
  if (hit !== null) return JSON.parse(hit);

  const lockKey = "lock:" + key;

  while (true) {
    // Only one request can acquire this miss lock; lock expiry prevents stale locks.
    const gotLock = await redis.set(lockKey, "1", "NX", "EX", 5);

    if (gotLock === "OK") {
      try {
        // Double-check after acquiring the lock in case the previous holder filled cache.
        const secondHit = await redis.get(key);
        if (secondHit !== null) return JSON.parse(secondHit);

        const value = await fetcher();
        await redis.set(key, JSON.stringify(value), "EX", ttl);
        return value;
      } finally {
        await redis.del(lockKey);
      }
    }

    // Another request is populating the cache. Poll instead of starting duplicate DB work.
    await sleep(50);
    const populated = await redis.get(key);
    if (populated !== null) return JSON.parse(populated);
    // If the lock holder failed or its five-second lock expired, try to acquire it.
  }
}
