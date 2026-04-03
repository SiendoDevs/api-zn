import { Router } from "express";
import { prisma } from "../db.js";
import { z } from "zod";
import { authRequired, roleAllowed } from "../middleware/auth.js";
import { Role } from "../../generated/prisma/enums.js";

const router = Router();

const resultSchema = z.object({
  pilotId: z.string().min(1),
  position: z.number().int().min(1),
  lapTimeMs: z.number().int().optional(),
  secondBestLapMs: z.number().int().optional(),
  totalTimeMs: z.number().int().optional(),
  gapMs: z.number().int().optional(),
  gapText: z.string().min(1).optional(),
  laps: z.number().int().optional(),
  points: z.number().int().optional(),
  penaltyMs: z.number().int().optional(),
  status: z.string().min(1).optional(),
});

router.get(
  "/sessions/:sessionId/results",
  authRequired,
  roleAllowed([Role.TIMEKEEPER, Role.ORGANIZER]),
  async (req, res) => {
    const sessionId = req.params.sessionId as string;
    const results = await prisma.sessionResult.findMany({
      where: { sessionId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        sessionId: true,
        pilotId: true,
        position: true,
        lapTimeMs: true,
        secondBestLapMs: true,
        totalTimeMs: true,
        gapMs: true,
        gapText: true,
        laps: true,
        points: true,
        penaltyMs: true,
        status: true,
        pilot: { select: { id: true, name: true, number: true } },
      },
    });
    res.json(results);
  }
);

router.post(
  "/sessions/:sessionId/results",
  authRequired,
  roleAllowed([Role.TIMEKEEPER, Role.ORGANIZER]),
  async (req, res) => {
    const sessionId = req.params.sessionId as string;
    const parsed = resultSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid" });
    const r = await prisma.sessionResult.upsert({
      where: { sessionId_pilotId: { sessionId, pilotId: parsed.data.pilotId } },
      update: {
        position: parsed.data.position,
        lapTimeMs: parsed.data.lapTimeMs,
        secondBestLapMs: parsed.data.secondBestLapMs,
        totalTimeMs: parsed.data.totalTimeMs,
        gapMs: parsed.data.gapMs,
        gapText: parsed.data.gapText,
        laps: parsed.data.laps,
        points: parsed.data.points,
        penaltyMs: parsed.data.penaltyMs ?? 0,
        status: parsed.data.status,
      },
      create: {
        sessionId,
        pilotId: parsed.data.pilotId,
        position: parsed.data.position,
        lapTimeMs: parsed.data.lapTimeMs,
        secondBestLapMs: parsed.data.secondBestLapMs,
        totalTimeMs: parsed.data.totalTimeMs,
        gapMs: parsed.data.gapMs,
        gapText: parsed.data.gapText,
        laps: parsed.data.laps,
        points: parsed.data.points,
        penaltyMs: parsed.data.penaltyMs ?? 0,
        status: parsed.data.status ?? "CLASSIFIED",
      },
    });
    res.status(201).json(r);
  }
);

router.post(
  "/sessions/:sessionId/publish",
  authRequired,
  roleAllowed([Role.ORGANIZER]),
  async (req, res) => {
    const sessionId = req.params.sessionId as string;
    const s = await prisma.session.update({
      where: { id: sessionId },
      data: { published: true },
    });
    res.json(s);
  }
);

router.get("/public/events/:eventId/results", async (req, res) => {
  const eventId = req.params.eventId as string;
  const sessions = await prisma.session.findMany({
    where: { eventId, published: true },
    orderBy: { order: "asc" },
    include: {
      results: {
        orderBy: { position: "asc" },
        include: { pilot: true },
      },
    },
  });
  res.json(sessions);
});

export default router;
