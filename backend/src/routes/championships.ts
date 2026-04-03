import { Router } from "express";
import { prisma } from "../db.js";
import { z } from "zod";
import { authRequired, roleAllowed } from "../middleware/auth.js";
import { Role } from "../../generated/prisma/enums.js";
import fs from "fs/promises";
import path from "path";

const router = Router();

router.get("/", async (_req, res) => {
  const list = await prisma.championship.findMany({ orderBy: { createdAt: "desc" } });
  res.json(list);
});

router.get("/:id/teams", async (req, res) => {
  const championshipId = req.params.id as string;
  if (!championshipId) return res.status(400).json({ error: "invalid" });

  const teams = await prisma.team.findMany({
    where: { championshipId },
    orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    include: {
      category: { select: { id: true, name: true, entrySize: true } },
      subcategory: { select: { id: true, name: true, categoryId: true } },
      members: {
        orderBy: { order: "asc" },
        include: { pilot: { select: { id: true, name: true, number: true } } },
      },
    },
  });
  res.json(teams);
});

const createSchema = z.object({
  name: z.string().min(3),
  season: z.number().int(),
  status: z.enum(["PENDING", "CONFIRMED", "CANCELED"]).optional(),
});

router.post("/", authRequired, roleAllowed([Role.ORGANIZER]), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid" });
  const data = await prisma.championship.create({ data: { name: parsed.data.name, season: parsed.data.season, status: parsed.data.status ?? "PENDING" } });
  res.status(201).json(data);
});

const patchSchema = z.object({
  name: z.string().min(3).optional(),
  season: z.number().int().optional(),
  status: z.enum(["PENDING", "CONFIRMED", "CANCELED"]).optional(),
});
router.patch("/:id", authRequired, roleAllowed([Role.ORGANIZER]), async (req, res) => {
  const id = req.params.id as string;
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid" });
  const hasAny =
    parsed.data.name !== undefined ||
    parsed.data.season !== undefined ||
    parsed.data.status !== undefined;
  if (!hasAny) return res.status(400).json({ error: "invalid" });

  const data: { name?: string; season?: number; status?: "PENDING" | "CONFIRMED" | "CANCELED" } = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.season !== undefined) data.season = parsed.data.season;
  if (parsed.data.status !== undefined) data.status = parsed.data.status;

  const upd = await prisma.championship.update({ where: { id }, data }).catch(() => null);
  if (!upd) return res.status(404).json({ error: "not_found" });
  res.json(upd);
});

const coverSchema = z.object({ dataUrl: z.string().min(1) });
router.post("/:id/cover", authRequired, roleAllowed([Role.ORGANIZER]), async (req, res) => {
  const id = req.params.id as string;
  const parsed = coverSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid" });

  const champ = await prisma.championship.findUnique({ where: { id }, select: { id: true } }).catch(() => null);
  if (!champ) return res.status(404).json({ error: "not_found" });

  const m = parsed.data.dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return res.status(400).json({ error: "invalid_data_url" });
  const mime = m[1] ?? "";
  const b64 = m[2] ?? "";
  if (!b64) return res.status(400).json({ error: "invalid_data_url" });

  const ext =
    mime === "image/png" ? "png" :
      mime === "image/jpeg" ? "jpg" :
        mime === "image/jpg" ? "jpg" :
          mime === "image/pjpeg" ? "jpg" :
        mime === "image/webp" ? "webp" :
          null;
  if (!ext) return res.status(415).json({ error: "unsupported_image_type" });

  let buf: Buffer
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return res.status(400).json({ error: "invalid_data_url" });
  }
  if (!buf.length) return res.status(400).json({ error: "invalid_data_url" });
  if (buf.length > 12 * 1024 * 1024) return res.status(413).json({ error: "image_too_large" });

  const dir = path.join(process.cwd(), "uploads", "championship-covers");
  await fs.mkdir(dir, { recursive: true });
  const fileName = `${id}-${Date.now()}.${ext}`;
  const abs = path.join(dir, fileName);
  await fs.writeFile(abs, buf);

  const coverImagePath = `/uploads/championship-covers/${fileName}`;
  const upd = await prisma.championship.update({ where: { id }, data: { coverImagePath } }).catch(() => null);
  if (!upd) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true, id, coverImagePath });
});

router.delete("/:id", authRequired, roleAllowed([Role.ORGANIZER]), async (req, res) => {
  const id = req.params.id as string;
  try {
    const events = await prisma.event.findMany({ where: { championshipId: id }, select: { id: true } });
    const eventIds = events.map((e: { id: string }) => e.id);
    const sessions = await prisma.session.findMany({ where: { eventId: { in: eventIds } }, select: { id: true } });
    const sessionIds = sessions.map((s: { id: string }) => s.id);
    const categories = await prisma.category.findMany({ where: { championshipId: id }, select: { id: true } });
    const categoryIds = categories.map((c: { id: string }) => c.id);

    await prisma.$transaction([
      prisma.sessionResult.deleteMany({ where: { sessionId: { in: sessionIds } } }),
      prisma.session.deleteMany({ where: { id: { in: sessionIds } } }),
      prisma.registration.deleteMany({ where: { categoryId: { in: categoryIds } } }),
      prisma.category.deleteMany({ where: { id: { in: categoryIds } } }),
      prisma.event.deleteMany({ where: { id: { in: eventIds } } }),
      prisma.championship.delete({ where: { id } }),
    ]);
    res.json({ ok: true, id });
  } catch {
    res.status(404).json({ error: "not_found" });
  }
});

export default router;
