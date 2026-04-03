import { Router } from "express";
import { prisma } from "../db.js";
import { z } from "zod";
import { authRequired, roleAllowed } from "../middleware/auth.js";
import { Role, RegistrationStatus } from "../../generated/prisma/enums.js";

const router = Router();

const createSchema = z.object({
  categoryId: z.string().min(1),
});

router.post("/", authRequired, roleAllowed([Role.PILOT]), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid" });
  const userId = req.user!.id;
  const pilot = await prisma.pilotProfile.findUnique({ where: { userId } });
  if (!pilot) return res.status(400).json({ error: "no_pilot_profile" });
  const registration = await prisma.registration.create({
    data: { pilotId: pilot.id, categoryId: parsed.data.categoryId },
  });
  res.status(201).json(registration);
});

router.get("/", authRequired, async (req, res) => {
  const me = req.query.pilot === "me";
  if (me) {
    const userId = req.user!.id;
    const pilot = await prisma.pilotProfile.findUnique({ where: { userId } });
    if (!pilot) return res.json([]);
    const regs = await prisma.registration.findMany({
      where: { pilotId: pilot.id },
      include: { category: true },
    });
    return res.json(regs);
  }
  // Fallback: list all (organizer only)
  if (req.user?.role !== Role.ORGANIZER) return res.status(403).json({ error: "forbidden" });

  const { championshipId } = req.query;
  const where: any = {};
  if (championshipId) {
    where.category = { championshipId: String(championshipId) };
  }

  const regs = await prisma.registration.findMany({
    where,
    include: { category: true, pilot: true }
  });
  res.json(regs);
});

const patchSchema = z.object({ status: z.nativeEnum(RegistrationStatus) });
router.patch("/:id", authRequired, roleAllowed([Role.ORGANIZER]), async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid" });
  const id = req.params.id as string;
  const updated = await prisma.registration.update({
    where: { id },
    data: { status: parsed.data.status },
  });
  res.json(updated);
});

export default router;
