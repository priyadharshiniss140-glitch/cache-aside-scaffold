# Cache-Aside + Stampede Protection

Express + Prisma + SQLite read endpoints cached with Redis. This implementation uses cache-aside, endpoint-specific TTLs, write invalidation, and a short-lived Redis lock to protect cold-cache misses from a stampede.

## Setup

Node.js 20.6+ is needed for the built-in `--env-file` option used by the start scripts.

```bash
npm install
docker start redis-m4          # or another Redis instance
cp .env.example .env           # set REDIS_URL if your Redis is not local
npm run db:push
npm run seed                   # inserts users + 40 posts; prints a user id
npm start                      # http://localhost:3000
```

## Cache-aside and stampede protection

`src/cache/cached.js` implements `cached(key, ttl, fetcher)`:

1. Read the key with `GET`; a hit is JSON-decoded and returned without querying Prisma.
2. On a miss, try `SET lock:<key> 1 NX EX 5`.
3. The lock winner re-checks the cache, runs the fetcher, stores the JSON value with `SET <key> <json> EX <ttl>`, and releases the lock in `finally`.
4. Other requests sleep about 50 ms and re-read the cache. If it is still empty, they retry lock acquisition rather than all starting the slow query at once.

The lock expires after five seconds so a crashed process cannot leave a permanent lock. The cached data's TTL is deliberately independent from the lock TTL.

## TTL reasoning

| Endpoint | Cache key | TTL | Why |
|---|---|---:|---|
| `GET /posts/feed?page=&sort=new\|hot` | `posts:feed:v<version>:page:<page>:sort:<sort>` | 15 seconds | Feeds change frequently, so short staleness is preferable. New posts also advance the version immediately. |
| `GET /users/:id` | `user:<id>:profile` | 300 seconds | Profiles change less frequently, and the corresponding PUT explicitly clears the edited user's key. |

The feed key includes the normalized `page` and `sort`, so pages and ordering variants never collide. The profile key always includes the user's ID.

## Invalidation rules

| Write | Invalidation |
|---|---|
| `POST /posts` | `invalidate.onNewPost()` increments `posts:feed:version`. |
| `PUT /users/:id` | `invalidate.onProfileEdit(id)` deletes only `user:<id>:profile`. |

**Paginated feed without Redis `KEYS`:** version-counter invalidation. Each read includes the current `posts:feed:version` in its cache key. Creating a post atomically increments the counter, so every page/sort variant from the previous version becomes unreachable immediately. Old entries expire through the 15-second TTL; Redis is never scanned with `KEYS posts:feed:*`.

The invalidation rules live in the single `src/cache/invalidation.js` module and are called by the write routes after a successful database write.

## Verify invalidation

Start the server in one terminal, then run the command in another terminal using the user ID printed by `npm run seed`:

```bash
AUTHOR_ID=<seeded-user-id> npm run verify
```

The verified run printed:

```text
PASS: feed fresh after first write
PASS: feed fresh after second write (invalidation works)
PASS: profile cache invalidated after PUT /users/<id>
```

## Load-test methodology

The before run used the unchanged `main` implementation; the after run used this cached branch. Both ran on the same GitHub Actions runner with Redis 7, SQLite, `SLOW_MS=40`, 50 concurrent workers, and 2,000 requests per endpoint. The after run warmed each cache before measuring. These numbers are one controlled sample; hosted-runner timings vary.

### Results (before → after)

| Endpoint | req/s before | req/s after | p50 before → after | p99 before → after |
|---|---:|---:|---:|---:|
| `GET /posts/feed` | 768 | 1,850 | 61.6 ms → 24.6 ms | 125.2 ms → 56.4 ms |
| `GET /users/:id` | 822 | 2,370 | 58.1 ms → 18.5 ms | 89.8 ms → 50.9 ms |

Both read endpoints improved in throughput (approximately 2.4× for the feed and 2.9× for profiles). The p50 and p99 latencies fell for each endpoint, and the p99 tail moved closer to p50 after warming the cache.

[View the successful Redis-backed verification and benchmark run](https://github.com/priyadharshiniss140-glitch/cache-aside-scaffold/actions/runs/39731104897)

## Run locally

```bash
npm run seed
npm start
# In another terminal, use the seeded user ID:
AUTHOR_ID=<seeded-user-id> npm run verify
node scripts/load.js /posts/feed 50 2000
node scripts/load.js /users/<seeded-user-id> 50 2000
```

No `.env` file or `node_modules/` folder should be committed.
