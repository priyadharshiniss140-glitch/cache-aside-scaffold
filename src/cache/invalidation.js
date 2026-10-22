import { redis } from "../redis.js";

// Bumping this version invalidates every page/sort variant without Redis KEYS.
export const FEED_VERSION_KEY = "posts:feed:version";

export async function getFeedVersion() {
  return (await redis.get(FEED_VERSION_KEY)) ?? "0";
}

export const invalidate = {
  // A versioned key invalidates all pages and sort orders in O(1).
  onNewPost: async () => {
    await redis.incr(FEED_VERSION_KEY);
  },

  // Profile invalidation is precise: only this user's cached profile is removed.
  onProfileEdit: async (userId) => {
    await redis.del(`user:${userId}:profile`);
  },
};
