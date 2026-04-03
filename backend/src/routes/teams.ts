import { Router } from "express";
import { prisma } from "../db.js";
import { z } from "zod";
import { authRequired, roleAllowed } from "../middleware/auth.js";
import { Role } from "../../generated/prisma/enums.js";

const router = Router();

router.get("/", authRequired, roleAllowed([Role.ORGANIZER]), async (req, res) => {
  const championshipId = String(req.query.championshipId ?? "").trim();
  if (!championshipId) return res.status(400).json({ error: "championshipId_required" });

  const teams = await prisma.team.findMany({
    where: { championshipId },
    orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    include: {
      category: { select: { id: true, name: true, entrySize: true } },
      subcategory: { select: { id: true, name: true } },
      members: {
        orderBy: { order: "asc" },
        include: { pilot: { select: { id: true, name: true, number: true } } },
      },
    },
  });
  res.json(teams);
});

const upsertSchema = z.object({
  championshipId: z.string().min(1),
  categoryId: z.string().min(1),
  subcategoryId: z.union([z.string().min(1), z.null()]).optional(),
  name: z.string().trim().min(2),
  pilotIds: z.array(z.string().min(1)).min(1),
});

router.post("/", authRequired, roleAllowed([Role.ORGANIZER]), async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid" });

  const { championshipId, categoryId, name, pilotIds } = parsed.data;
  const subcategoryId =
    parsed.data.subcategoryId === undefined ? null : parsed.data.subcategoryId;

  const cat = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true, championshipId: true, entrySize: true },
  }).catch(() => null);
  if (!cat || cat.championshipId !== championshipId) return res.status(400).json({ error: "invalid_category" });
  if (cat.entrySize === "SINGLE") return res.status(400).json({ error: "category_not_team" });

  if (subcategoryId) {
    const sub = await prisma.subcategory.findUnique({ where: { id: subcategoryId }, select: { id: true, categoryId: true } }).catch(() => null);
    if (!sub || sub.categoryId !== cat.id) return res.status(400).json({ error: "invalid_subcategory" });
  }

  const uniquePilotIds = Array.from(new Set(pilotIds.map((p) => p.trim()).filter(Boolean)));
  if (uniquePilotIds.length !== pilotIds.length) return res.status(400).json({ error: "duplicate_pilots" });

  const maxSize = cat.entrySize === "BINOMIO" ? 2 : 4;
  if (uniquePilotIds.length > maxSize) return res.status(400).json({ error: "team_too_large" });

  const regs = await prisma.registration.findMany({
    where: {
      categoryId: cat.id,
      status: "APPROVED",
      pilotId: { in: uniquePilotIds },
    },
    select: { pilotId: true },
  });
  if (regs.length !== uniquePilotIds.length) return res.status(400).json({ error: "pilot_not_registered" });

  try {
    const created = await prisma.team.create({
      data: {
        championshipId,
        categoryId: cat.id,
        subcategoryId,
        name,
        members: {
          create: uniquePilotIds.map((pilotId, idx) => ({
            pilotId,
            championshipId,
            categoryId: cat.id,
            order: idx + 1,
          })),
        },
      },
      include: {
        category: { select: { id: true, name: true, entrySize: true } },
        subcategory: { select: { id: true, name: true } },
        members: { orderBy: { order: "asc" }, include: { pilot: { select: { id: true, name: true, number: true } } } },
      },
    });
    res.status(201).json(created);
  } catch (e: any) {
    const msg = `${String(e?.code ?? "")} ${String(e?.message ?? "")} ${JSON.stringify(e?.meta ?? {})}`;
    if (msg.includes("unique_pilot_per_category_team") || msg.includes("unique_team_member")) {
      return res.status(409).json({ error: "pilot_already_assigned" });
    }
    res.status(500).json({ error: "server_error" });
  }
});

const patchSchema = z.object({
  name: z.string().trim().min(2).optional(),
  subcategoryId: z.union([z.string().min(1), z.null()]).optional(),
  pilotIds: z.array(z.string().min(1)).min(1).optional(),
});

router.patch("/:teamId", authRequired, roleAllowed([Role.ORGANIZER]), async (req, res) => {
  const teamId = req.params.teamId as string;
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid" });

  const current = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, championshipId: true, categoryId: true, subcategoryId: true, category: { select: { entrySize: true } } },
  }).catch(() => null);
  if (!current) return res.status(404).json({ error: "not_found" });

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;

  if (parsed.data.subcategoryId !== undefined) {
    const nextSub = parsed.data.subcategoryId;
    if (nextSub) {
      const sub = await prisma.subcategory.findUnique({ where: { id: nextSub }, select: { id: true, categoryId: true } }).catch(() => null);
      if (!sub || sub.categoryId !== current.categoryId) return res.status(400).json({ error: "invalid_subcategory" });
      data.subcategoryId = nextSub;
    } else {
      data.subcategoryId = null;
    }
  }

  const maxSize = current.category.entrySize === "BINOMIO" ? 2 : 4;
  if (parsed.data.pilotIds) {
    const uniquePilotIds = Array.from(new Set(parsed.data.pilotIds.map((p) => p.trim()).filter(Boolean)));
    if (uniquePilotIds.length !== parsed.data.pilotIds.length) return res.status(400).json({ error: "duplicate_pilots" });
    if (uniquePilotIds.length > maxSize) return res.status(400).json({ error: "team_too_large" });

    const regs = await prisma.registration.findMany({
      where: {
        categoryId: current.categoryId,
        status: "APPROVED",
        pilotId: { in: uniquePilotIds },
      },
      select: { pilotId: true },
    });
    if (regs.length !== uniquePilotIds.length) return res.status(400).json({ error: "pilot_not_registered" });

    try {
      const updated = await prisma.$transaction(async (tx) => {
        await tx.teamMember.deleteMany({ where: { teamId } });
        await tx.team.update({ where: { id: teamId }, data });
        await tx.teamMember.createMany({
          data: uniquePilotIds.map((pilotId, idx) => ({
            teamId,
            pilotId,
            championshipId: current.championshipId,
            categoryId: current.categoryId,
            order: idx + 1,
          })),
        });
        return tx.team.findUnique({
          where: { id: teamId },
          include: {
            category: { select: { id: true, name: true, entrySize: true } },
            subcategory: { select: { id: true, name: true } },
            members: { orderBy: { order: "asc" }, include: { pilot: { select: { id: true, name: true, number: true } } } },
          },
        });
      });
      res.json(updated);
    } catch (e: any) {
      const msg = `${String(e?.code ?? "")} ${String(e?.message ?? "")} ${JSON.stringify(e?.meta ?? {})}`;
      if (msg.includes("unique_pilot_per_category_team") || msg.includes("unique_team_member")) {
        return res.status(409).json({ error: "pilot_already_assigned" });
      }
      res.status(500).json({ error: "server_error" });
    }
    return;
  }

  const updated = await prisma.team.update({
    where: { id: teamId },
    data,
    include: {
      category: { select: { id: true, name: true, entrySize: true } },
      subcategory: { select: { id: true, name: true } },
      members: { orderBy: { order: "asc" }, include: { pilot: { select: { id: true, name: true, number: true } } } },
    },
  });
  res.json(updated);
});

router.delete("/:teamId", authRequired, roleAllowed([Role.ORGANIZER]), async (req, res) => {
  const teamId = req.params.teamId as string;
  try {
    await prisma.team.delete({ where: { id: teamId } });
    res.json({ ok: true, id: teamId });
  } catch {
    res.status(404).json({ error: "not_found" });
  }
});

export default router;
