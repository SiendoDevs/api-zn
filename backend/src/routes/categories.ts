import { Router } from "express";
import { prisma } from "../db.js";
import { z } from "zod";
import { authRequired, roleAllowed } from "../middleware/auth.js";
import { Role } from "../../generated/prisma/enums.js";

const router = Router();

// Nuevo: categorías por campeonato
router.get("/championships/:championshipId/categories", async (req, res) => {
  const championshipId = req.params.championshipId as string;
  const categories = await prisma.category.findMany({
    where: { championshipId },
    orderBy: { name: "asc" },
    include: { subcategories: { orderBy: { name: "asc" } } },
  });
  res.json(categories);
});

const schema = z.object({
  name: z.string().min(2),
  entrySize: z.enum(["SINGLE", "BINOMIO", "EQUIPO"]).optional(),
  singlePointsPolicy: z.enum(["SUM_ALL", "FIRST_SESSION_PER_EVENT"]).optional(),
  motorOrigin: z.enum(["NACIONAL", "IMPORTADO"]).optional(),
  tireOrigin: z.enum(["NACIONAL", "IMPORTADO"]).optional(),
  chassisOrigin: z.enum(["NACIONAL", "IMPORTADO"]).optional(),
});
router.post(
  "/championships/:championshipId/categories",
  authRequired,
  roleAllowed([Role.ORGANIZER]),
  async (req, res) => {
    const championshipId = req.params.championshipId as string;
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid" });
    const entrySize = parsed.data.entrySize ?? "SINGLE";
    const category = await prisma.category.create({
      data: {
        name: parsed.data.name,
        championshipId,
        entrySize,
        singlePointsPolicy: entrySize === "SINGLE" ? "SUM_ALL" : (parsed.data.singlePointsPolicy ?? "SUM_ALL"),
        motorOrigin: parsed.data.motorOrigin ?? "NACIONAL",
        tireOrigin: parsed.data.tireOrigin ?? "NACIONAL",
        chassisOrigin: parsed.data.chassisOrigin ?? "NACIONAL",
      },
    });
    res.status(201).json(category);
  }
);

router.patch(
  "/:id",
  authRequired,
  roleAllowed([Role.ORGANIZER]),
  async (req, res) => {
    const id = req.params.id as string;
    const parsed = schema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid" });

    const current = await prisma.category.findUnique({ where: { id } }).catch(() => null);
    if (!current) return res.status(404).json({ error: "not_found" });

    const entrySize = parsed.data.entrySize ?? current.entrySize;
    const singlePointsPolicy =
      entrySize === "SINGLE"
        ? "SUM_ALL"
        : (parsed.data.singlePointsPolicy ?? current.singlePointsPolicy);

    const updated = await prisma.category.update({
      where: { id },
      data: {
        name: parsed.data.name,
        entrySize: parsed.data.entrySize,
        singlePointsPolicy,
        motorOrigin: parsed.data.motorOrigin,
        tireOrigin: parsed.data.tireOrigin,
        chassisOrigin: parsed.data.chassisOrigin,
      },
    });
    res.json(updated);
  }
);

router.delete(
  "/:id",
  authRequired,
  roleAllowed([Role.ORGANIZER]),
  async (req, res) => {
    const id = req.params.id as string;
    try {
      await prisma.category.delete({ where: { id } });
      res.json({ ok: true, id });
    } catch (e) {
      // P2003 is foreign key constraint failure
      if ((e as any).code === 'P2003') {
        return res.status(409).json({ error: "constraint_violation", message: "No se puede eliminar la categoría porque tiene registros asociados." });
      }
      res.status(404).json({ error: "not_found" });
    }
  }
);

// Compatibilidad: endpoints previos por evento mapean al campeonato del evento
router.get("/events/:eventId/categories", async (req, res) => {
  const eventId = req.params.eventId as string;
  const ev = await prisma.event.findUnique({ where: { id: eventId } });
  if (!ev) return res.status(404).json({ error: "event_not_found" });
  const categories = await prisma.category.findMany({
    where: { championshipId: ev.championshipId },
    orderBy: { name: "asc" },
    include: { subcategories: { orderBy: { name: "asc" } } },
  });
  res.json(categories);
});

const subSchema = z.object({
  name: z.string().min(2),
});

router.get("/:categoryId/subcategories", async (req, res) => {
  const categoryId = req.params.categoryId as string;
  const list = await prisma.subcategory.findMany({
    where: { categoryId },
    orderBy: { name: "asc" },
  });
  res.json(list);
});

router.post(
  "/:categoryId/subcategories",
  authRequired,
  roleAllowed([Role.ORGANIZER]),
  async (req, res) => {
    const categoryId = req.params.categoryId as string;
    const parsed = subSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid" });

    const exists = await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true } }).catch(() => null);
    if (!exists) return res.status(404).json({ error: "not_found" });

    try {
      const created = await prisma.subcategory.create({
        data: { name: parsed.data.name, categoryId },
      });
      res.status(201).json(created);
    } catch (e) {
      if ((e as any).code === "P2002") return res.status(409).json({ error: "exists" });
      res.status(500).json({ error: "server_error" });
    }
  }
);

router.patch(
  "/subcategories/:id",
  authRequired,
  roleAllowed([Role.ORGANIZER]),
  async (req, res) => {
    const id = req.params.id as string;
    const parsed = subSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid" });
    if (parsed.data.name === undefined) return res.status(400).json({ error: "invalid" });

    try {
      const updated = await prisma.subcategory.update({
        where: { id },
        data: { name: parsed.data.name },
      });
      res.json(updated);
    } catch (e) {
      if ((e as any).code === "P2002") return res.status(409).json({ error: "exists" });
      res.status(404).json({ error: "not_found" });
    }
  }
);

router.delete(
  "/subcategories/:id",
  authRequired,
  roleAllowed([Role.ORGANIZER]),
  async (req, res) => {
    const id = req.params.id as string;
    try {
      await prisma.subcategory.delete({ where: { id } });
      res.json({ ok: true, id });
    } catch {
      res.status(404).json({ error: "not_found" });
    }
  }
);

router.post(
  "/events/:eventId/categories",
  authRequired,
  roleAllowed([Role.ORGANIZER]),
  async (req, res) => {
    const eventId = req.params.eventId as string;
    const ev = await prisma.event.findUnique({ where: { id: eventId } });
    if (!ev) return res.status(404).json({ error: "event_not_found" });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid" });
    const entrySize = parsed.data.entrySize ?? "SINGLE";
    const category = await prisma.category.create({
      data: {
        name: parsed.data.name,
        championshipId: ev.championshipId,
        entrySize,
        singlePointsPolicy: entrySize === "SINGLE" ? "SUM_ALL" : (parsed.data.singlePointsPolicy ?? "SUM_ALL"),
        motorOrigin: parsed.data.motorOrigin ?? "NACIONAL",
        tireOrigin: parsed.data.tireOrigin ?? "NACIONAL",
        chassisOrigin: parsed.data.chassisOrigin ?? "NACIONAL",
      },
    });
    res.status(201).json(category);
  }
);

export default router;
