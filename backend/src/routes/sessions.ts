import { Router } from "express";
import { prisma } from "../db.js";
import { z } from "zod";
import { authRequired, roleAllowed } from "../middleware/auth.js";
import { Role, SessionType } from "../../generated/prisma/enums.js";

const router = Router();

router.get("/events/:eventId/sessions", async (req, res) => {
  const eventId = req.params.eventId as string;
  const sessions = await prisma.session.findMany({
    where: { eventId },
    orderBy: { order: "asc" },
    include: {
      category: { select: { id: true, name: true } },
      subcategory: { select: { id: true, name: true, categoryId: true } },
    },
  });
  res.json(sessions);
});

const createSchema = z.object({
  name: z.string().min(2),
  order: z.number().int(),
  type: z.nativeEnum(SessionType),
  categoryId: z.string().min(1),
  subcategoryId: z.string().min(1).optional(),
  date: z
    .string()
    .min(1)
    .refine((v) => !Number.isNaN(Date.parse(v)), { message: "invalid_date" })
    .optional(),
  location: z.string().trim().min(1).optional(),
});

router.post(
  "/events/:eventId/sessions",
  authRequired,
  roleAllowed([Role.ORGANIZER]),
  async (req, res) => {
    const eventId = req.params.eventId as string;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid" });

    const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { championshipId: true } }).catch(() => null);
    if (!ev) return res.status(404).json({ error: "event_not_found" });

    const cat = await prisma.category.findUnique({ where: { id: parsed.data.categoryId }, select: { id: true, championshipId: true } }).catch(() => null);
    if (!cat || cat.championshipId !== ev.championshipId) return res.status(400).json({ error: "invalid_category" });

    if (parsed.data.subcategoryId) {
      const sub = await prisma.subcategory.findUnique({ where: { id: parsed.data.subcategoryId }, select: { id: true, categoryId: true } }).catch(() => null);
      if (!sub || sub.categoryId !== cat.id) return res.status(400).json({ error: "invalid_subcategory" });
    }

    const s = await prisma.session.create({
      data: {
        eventId,
        categoryId: cat.id,
        subcategoryId: parsed.data.subcategoryId,
        name: parsed.data.name,
        order: parsed.data.order,
        type: parsed.data.type,
        location: parsed.data.location,
        ...(parsed.data.date ? { date: new Date(parsed.data.date) } : {}),
      },
      include: {
        category: { select: { id: true, name: true } },
        subcategory: { select: { id: true, name: true, categoryId: true } },
      },
    });
    res.status(201).json(s);
  }
);

const bulkSchema = z.array(createSchema).min(1);
router.post(
  "/events/:eventId/sessions/bulk",
  authRequired,
  roleAllowed([Role.ORGANIZER]),
  async (req, res) => {
    const eventId = req.params.eventId as string;
    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid" });
    try {
      const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { championshipId: true } }).catch(() => null);
      if (!ev) return res.status(404).json({ error: "event_not_found" });

      const uniqueCategoryIds = Array.from(new Set(parsed.data.map(r => r.categoryId)));
      const cats = await prisma.category.findMany({ where: { id: { in: uniqueCategoryIds } }, select: { id: true, championshipId: true } });
      const catById = new Map(cats.map(c => [c.id, c]));
      for (const cId of uniqueCategoryIds) {
        const c = catById.get(cId);
        if (!c || c.championshipId !== ev.championshipId) return res.status(400).json({ error: "invalid_category" });
      }

      const uniqueSubIds = Array.from(new Set(parsed.data.map(r => r.subcategoryId).filter(Boolean))) as string[];
      if (uniqueSubIds.length) {
        const subs = await prisma.subcategory.findMany({ where: { id: { in: uniqueSubIds } }, select: { id: true, categoryId: true } });
        const subById = new Map(subs.map(s => [s.id, s]));
        for (const row of parsed.data) {
          if (!row.subcategoryId) continue;
          const s = subById.get(row.subcategoryId);
          if (!s || s.categoryId !== row.categoryId) return res.status(400).json({ error: "invalid_subcategory" });
        }
      }

      await prisma.session.createMany({
        data: parsed.data.map((r) => ({
          eventId,
          categoryId: r.categoryId,
          subcategoryId: r.subcategoryId,
          name: r.name,
          order: r.order,
          type: r.type,
          location: r.location,
          ...(r.date ? { date: new Date(r.date) } : {}),
        })),
      });
      const list = await prisma.session.findMany({
        where: { eventId },
        orderBy: { order: "asc" },
        include: {
          category: { select: { id: true, name: true } },
          subcategory: { select: { id: true, name: true, categoryId: true } },
        },
      });
      res.status(201).json({ ok: true, count: parsed.data.length, sessions: list });
    } catch {
      res.status(500).json({ error: "server_error" });
    }
  }
);

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  order: z.number().int().optional(),
  type: z.nativeEnum(SessionType).optional(),
  categoryId: z.string().min(1).optional(),
  subcategoryId: z.union([z.string().min(1), z.null()]).optional(),
  date: z
    .union([
      z.string().min(1).refine((v) => !Number.isNaN(Date.parse(v)), { message: "invalid_date" }),
      z.null(),
    ])
    .optional(),
  location: z.union([z.string().trim().min(1), z.null()]).optional(),
});

router.patch(
  "/:sessionId",
  authRequired,
  roleAllowed([Role.ORGANIZER]),
  async (req, res) => {
    const sessionId = req.params.sessionId as string;
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid" });

    const current = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true, eventId: true, categoryId: true, subcategoryId: true },
    }).catch(() => null);
    if (!current) return res.status(404).json({ error: "not_found" });

    const ev = await prisma.event.findUnique({ where: { id: current.eventId }, select: { championshipId: true } }).catch(() => null);
    if (!ev) return res.status(404).json({ error: "event_not_found" });

    const nextCategoryId = parsed.data.categoryId ?? current.categoryId ?? "";
    if (!nextCategoryId) return res.status(400).json({ error: "invalid_category" });

    const cat = await prisma.category.findUnique({ where: { id: nextCategoryId }, select: { id: true, championshipId: true } }).catch(() => null);
    if (!cat || cat.championshipId !== ev.championshipId) return res.status(400).json({ error: "invalid_category" });

    const nextSubcategoryId =
      parsed.data.subcategoryId === undefined ? current.subcategoryId : parsed.data.subcategoryId;

    if (nextSubcategoryId) {
      const sub = await prisma.subcategory.findUnique({ where: { id: nextSubcategoryId }, select: { id: true, categoryId: true } }).catch(() => null);
      if (!sub || sub.categoryId !== cat.id) return res.status(400).json({ error: "invalid_subcategory" });
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.order !== undefined) data.order = parsed.data.order;
    if (parsed.data.type !== undefined) data.type = parsed.data.type;
    if (parsed.data.categoryId !== undefined) data.categoryId = cat.id;
    if (parsed.data.subcategoryId !== undefined) data.subcategoryId = parsed.data.subcategoryId;
    if (parsed.data.location !== undefined) data.location = parsed.data.location;
    if (parsed.data.date !== undefined) data.date = parsed.data.date ? new Date(parsed.data.date) : null;

    const updated = await prisma.session.update({
      where: { id: sessionId },
      data,
      include: {
        category: { select: { id: true, name: true } },
        subcategory: { select: { id: true, name: true, categoryId: true } },
      },
    });
    res.json(updated);
  }
);

router.delete(
  "/:sessionId",
  authRequired,
  roleAllowed([Role.ORGANIZER]),
  async (req, res) => {
    const sessionId = req.params.sessionId as string;
    try {
      await prisma.$transaction([
        prisma.sessionResult.deleteMany({ where: { sessionId } }),
        prisma.session.delete({ where: { id: sessionId } }),
      ]);
      res.json({ ok: true, id: sessionId });
    } catch {
      res.status(404).json({ error: "not_found" });
    }
  }
);

export default router;
