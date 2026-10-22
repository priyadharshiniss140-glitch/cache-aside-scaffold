import { Router } from "express";
import { prisma, slowQuery } from "../db.js";
import { cached } from "../cache/cached.js";
import { getFeedVersion, invalidate } from "../cache/invalidation.js";

const router = Router();

const FEED_TTL_SECONDS = 15;

router.get("/posts/feed", async (req, res) => {
  const parsedPage = Number.parseInt(String(req.query.page ?? "1"), 10);
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const sort = req.query.sort === "hot" ? "hot" : "new";

  // Include version, page and sort so feed variants cannot collide.
  const version = await getFeedVersion();
  const key = `posts:feed:v${version}:page:${page}:sort:${sort}`;

  const feed = await cached(key, FEED_TTL_SECONDS, async () => {
    await slowQuery(); // simulates a heavy, disk-backed query
    return prisma.post.findMany({
      orderBy: sort === "hot" ? { likes: "desc" } : { createdAt: "desc" },
      skip: (page - 1) * 20,
      take: 20,
      include: { author: true },
    });
  });

  res.json(feed);
});

router.post("/posts", async (req, res) => {
  const post = await prisma.post.create({ data: req.body });
  await invalidate.onNewPost();
  res.status(201).json(post);
});

export default router;
