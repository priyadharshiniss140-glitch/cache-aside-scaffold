import { Router } from "express";
import { prisma, slowQuery } from "../db.js";
import { cached } from "../cache/cached.js";
import { invalidate } from "../cache/invalidation.js";

const router = Router();

const PROFILE_TTL_SECONDS = 300;

router.get("/users/:id", async (req, res) => {
  const userId = req.params.id;
  const user = await cached(`user:${userId}:profile`, PROFILE_TTL_SECONDS, async () => {
    await slowQuery(); // simulates a heavy, disk-backed query
    return prisma.user.findUnique({
      where: { id: userId },
      include: { posts: true },
    });
  });

  if (!user) return res.status(404).json({ error: "not found" });
  res.json(user);
});

router.put("/users/:id", async (req, res) => {
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: req.body,
  });
  await invalidate.onProfileEdit(req.params.id);
  res.json(user);
});

export default router;
