import { Router } from "express";
import { prisma } from "../db.js";
import { z } from "zod";
import { authRequired, roleAllowed } from "../middleware/auth.js";
import { Role } from "../../generated/prisma/enums.js";

const router = Router();

router.get("/by-championship/:id", async (req, res) => {
  const id = req.params.id as string;
  const events = await prisma.event.findMany({
    where: { championshipId: id },
    orderBy: { date: "asc" },
    select: { id: true, name: true, date: true, location: true, trackType: true, circuitVariant: true, status: true },
  });
  res.json(events);
});

const createSchema = z.object({
  name: z.string().min(3),
  date: z.string(),
  location: z.string().min(2).optional(),
  trackType: z.enum(["KARTODROME", "AUTODROME"]).optional(),
  circuitVariant: z.string().optional(),
  status: z.enum(["PENDING", "CONFIRMED", "CANCELED"]).optional(),
});

router.post("/:championshipId", authRequired, roleAllowed([Role.ORGANIZER]), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid" });
  const championshipId = req.params.championshipId as string;
  const data = await prisma.event.create({
    data: {
      name: parsed.data.name,
      date: new Date(parsed.data.date),
      location: parsed.data.location,
      trackType: parsed.data.trackType,
      circuitVariant: parsed.data.circuitVariant?.trim() ? parsed.data.circuitVariant : null,
      status: parsed.data.status ?? "PENDING",
      championshipId,
    },
  });
  res.status(201).json(data);
});

const patchSchema = z.object({
  name: z.string().min(3).optional(),
  date: z.string().optional(),
  location: z.string().optional(),
  trackType: z.enum(["KARTODROME", "AUTODROME"]).optional(),
  circuitVariant: z.string().optional(),
  status: z.enum(["PENDING", "CONFIRMED", "CANCELED"]).optional(),
});
router.patch("/:eventId", authRequired, roleAllowed([Role.ORGANIZER]), async (req, res) => {
  const eventId = req.params.eventId as string;
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid" });
  const hasAny =
    parsed.data.name !== undefined ||
    parsed.data.date !== undefined ||
    parsed.data.location !== undefined ||
    parsed.data.trackType !== undefined ||
    parsed.data.circuitVariant !== undefined ||
    parsed.data.status !== undefined;
  if (!hasAny) return res.status(400).json({ error: "invalid" });

  const data: {
    name?: string;
    date?: Date;
    location?: string | null;
    trackType?: "KARTODROME" | "AUTODROME";
    circuitVariant?: string | null;
    status?: "PENDING" | "CONFIRMED" | "CANCELED";
  } = {};

  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.date !== undefined) data.date = new Date(parsed.data.date);
  if (parsed.data.location !== undefined) data.location = parsed.data.location.trim() ? parsed.data.location : null;
  if (parsed.data.trackType !== undefined) data.trackType = parsed.data.trackType;
  if (parsed.data.circuitVariant !== undefined) data.circuitVariant = parsed.data.circuitVariant.trim() ? parsed.data.circuitVariant : null;
  if (parsed.data.status !== undefined) data.status = parsed.data.status;

  const upd = await prisma.event.update({ where: { id: eventId }, data }).catch(() => null);
  if (!upd) return res.status(404).json({ error: "not_found" });
  res.json(upd);
});

router.delete("/:eventId", authRequired, roleAllowed([Role.ORGANIZER]), async (req, res) => {
  const eventId = req.params.eventId as string;
  try {
    const sessions = await prisma.session.findMany({ where: { eventId }, select: { id: true } });
    const sessionIds = sessions.map((s: { id: string }) => s.id);

    await prisma.$transaction([
      prisma.sessionResult.deleteMany({ where: { sessionId: { in: sessionIds } } }),
      prisma.session.deleteMany({ where: { id: { in: sessionIds } } }),
      prisma.event.delete({ where: { id: eventId } }),
    ]);
    res.json({ ok: true, id: eventId });
  } catch (e) {
    res.status(404).json({ error: "not_found" });
  }
});

export default router;
