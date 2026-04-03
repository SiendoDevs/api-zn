import { Router } from "express";
import { prisma } from "../db.js";
import { z } from "zod";
import { authRequired, roleAllowed } from "../middleware/auth.js";
import { Role, RegistrationStatus } from "../../generated/prisma/enums.js";
import type { Prisma } from "../../generated/prisma/client.js";
import bcrypt from "bcryptjs";

const router = Router();

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6).optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  number: z.number().int().min(1),
  country: z.string().optional(),
  city: z.string().optional(),
  age: z.number().int().optional(),
  phone: z.string().optional(),
  emergencyPhone: z.string().optional(),
  license: z.string().optional(),
  categoryIds: z.array(z.string()).optional(),
});

const publicOnboardingSchema = schema.extend({
  championshipId: z.string().min(1),
});

router.get("/me", authRequired, roleAllowed([Role.PILOT]), async (req, res) => {
  const userId = req.user!.id;
  const pilot = await prisma.pilotProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      name: true,
      number: true,
      firstName: true,
      lastName: true,
      country: true,
      city: true,
      age: true,
      phone: true,
      emergencyPhone: true,
      license: true,
      user: { select: { email: true } },
      registrations: {
        select: {
          id: true,
          status: true,
          category: { select: { id: true, name: true, championshipId: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!pilot) return res.status(404).json({ error: "not_found" });
  res.json({
    pilot: {
      id: pilot.id,
      name: pilot.name,
      number: pilot.number,
      email: pilot.user.email,
      firstName: pilot.firstName,
      lastName: pilot.lastName,
      country: pilot.country,
      city: pilot.city,
      age: pilot.age,
      phone: pilot.phone,
      emergencyPhone: pilot.emergencyPhone,
      license: pilot.license,
    },
    registrations: pilot.registrations.map((r) => ({
      id: r.id,
      status: r.status,
      category: r.category,
    })),
  });
});

router.get(
  "/",
  authRequired,
  roleAllowed([Role.ORGANIZER]),
  async (req, res) => {
    const { championshipId, categoryId } = req.query;

    const where: any = {};
    if (categoryId) {
      where.registrations = { some: { categoryId: String(categoryId) } };
    } else if (championshipId) {
      where.registrations = { some: { category: { championshipId: String(championshipId) } } };
    }

    const list = await prisma.pilotProfile.findMany({
      where,
      select: {
        id: true,
        name: true,
        number: true,
        firstName: true,
        lastName: true,
        country: true,
        city: true,
        age: true,
        phone: true,
        emergencyPhone: true,
        license: true,
        user: { select: { email: true } },
        _count: { select: { registrations: true } },
      },
      orderBy: { number: "asc" },
    });
    const mapped = list.map((p: {
      id: string
      name: string
      number: number
      firstName: string | null
      lastName: string | null
      country: string | null
      city: string | null
      age: number | null
      phone: string | null
      emergencyPhone: string | null
      license: string | null
      user: { email: string }
      _count: { registrations: number }
    }) => ({
      id: p.id,
      name: p.name,
      number: p.number,
      email: p.user.email,
      registrationsCount: p._count.registrations,
      firstName: p.firstName,
      lastName: p.lastName,
      country: p.country,
      city: p.city,
      age: p.age,
      phone: p.phone,
      emergencyPhone: p.emergencyPhone,
      license: p.license,
    }));
    res.json(mapped);
  }
);

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  number: z.number().int().min(1).optional(),
  email: z.string().email().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  age: z.number().int().optional(),
  phone: z.string().optional(),
  emergencyPhone: z.string().optional(),
  license: z.string().optional(),
});

router.patch(
  "/:id",
  authRequired,
  roleAllowed([Role.ORGANIZER]),
  async (req, res) => {
    const id = req.params.id as string;
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid" });
    const pilot = await prisma.pilotProfile.findUnique({ where: { id } });
    if (!pilot) return res.status(404).json({ error: "not_found" });
    try {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        if (parsed.data.email) {
          const existing = await tx.user.findUnique({ where: { email: parsed.data.email } });
          if (existing && existing.id !== pilot.userId) throw new Error("email_exists");
          await tx.user.update({ where: { id: pilot.userId }, data: { email: parsed.data.email } });
        }
        const nextFirst = parsed.data.firstName ?? undefined;
        const nextLast = parsed.data.lastName ?? undefined;
        const shouldUpdateNameFromParts = (nextFirst !== undefined || nextLast !== undefined) && parsed.data.name === undefined;
        let computedName: string | undefined = undefined;
        if (shouldUpdateNameFromParts) {
          const current = await tx.pilotProfile.findUnique({ where: { id } });
          const f = nextFirst !== undefined ? nextFirst : current?.firstName ?? "";
          const l = nextLast !== undefined ? nextLast : current?.lastName ?? "";
          computedName = `${(f || "").trim()} ${(l || "").trim()}`.trim() || undefined;
        }
        await tx.pilotProfile.update({
          where: { id },
          data: {
            name: parsed.data.name ?? computedName ?? undefined,
            number: parsed.data.number ?? undefined,
            firstName: parsed.data.firstName ?? undefined,
            lastName: parsed.data.lastName ?? undefined,
            country: parsed.data.country ?? undefined,
            city: parsed.data.city ?? undefined,
            age: parsed.data.age ?? undefined,
            phone: parsed.data.phone ?? undefined,
            emergencyPhone: parsed.data.emergencyPhone ?? undefined,
            license: parsed.data.license ?? undefined,
          },
        });
      });
      const updated = await prisma.pilotProfile.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          number: true,
          firstName: true,
          lastName: true,
          country: true,
          city: true,
          age: true,
          phone: true,
          emergencyPhone: true,
          license: true,
          user: { select: { email: true } },
          _count: { select: { registrations: true } },
        },
      });
      if (!updated) return res.status(404).json({ error: "not_found" });
      res.json({
        id: updated.id,
        name: updated.name,
        number: updated.number,
        email: updated.user.email,
        registrationsCount: updated._count.registrations,
        firstName: updated.firstName,
        lastName: updated.lastName,
        country: updated.country,
        city: updated.city,
        age: updated.age,
        phone: updated.phone,
        emergencyPhone: updated.emergencyPhone,
        license: updated.license,
      });
    } catch (e: any) {
      if (e?.message === "email_exists") return res.status(409).json({ error: "email_exists" });
      return res.status(500).json({ error: "server_error" });
    }
  }
);

router.delete(
  "/:id",
  authRequired,
  roleAllowed([Role.ORGANIZER]),
  async (req, res) => {
    const id = req.params.id as string;
    const pilot = await prisma.pilotProfile.findUnique({ where: { id } });
    if (!pilot) return res.status(404).json({ error: "not_found" });
    try {
      await prisma.$transaction([
        prisma.sessionResult.deleteMany({ where: { pilotId: id } }),
        prisma.registration.deleteMany({ where: { pilotId: id } }),
        prisma.pilotProfile.delete({ where: { id } }),
        prisma.user.delete({ where: { id: pilot.userId } }),
      ]);
      res.json({ ok: true, id });
    } catch {
      res.status(500).json({ error: "server_error" });
    }
  }
);

// Registrations management by organizer
router.get(
  "/:id/registrations",
  authRequired,
  roleAllowed([Role.ORGANIZER]),
  async (req, res) => {
    const id = req.params.id as string;
    const championshipId = (req.query.championshipId as string | undefined) ?? undefined;
    const regs = await prisma.registration.findMany({
      where: { pilotId: id, ...(championshipId ? { category: { championshipId } } : {}) },
      include: { category: true },
      orderBy: { createdAt: "asc" },
    });
    res.json(regs.map((r: any) => ({ id: r.id, categoryId: r.categoryId, status: r.status, category: { id: r.category.id, name: r.category.name, championshipId: r.category.championshipId } })));
  }
);

const regCreateSchema = z.object({ categoryId: z.string().min(1) });
router.post(
  "/:id/registrations",
  authRequired,
  roleAllowed([Role.ORGANIZER]),
  async (req, res) => {
    const id = req.params.id as string;
    const parsed = regCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid" });
    const exists = await prisma.registration.findFirst({ where: { pilotId: id, categoryId: parsed.data.categoryId } });
    if (exists) return res.status(409).json({ error: "exists" });
    const reg = await prisma.registration.create({
      data: { pilotId: id, categoryId: parsed.data.categoryId, status: RegistrationStatus.APPROVED },
    });
    res.status(201).json(reg);
  }
);

router.delete(
  "/:id/registrations/:registrationId",
  authRequired,
  roleAllowed([Role.ORGANIZER]),
  async (req, res) => {
    const id = req.params.id as string;
    const registrationId = req.params.registrationId as string;
    const reg = await prisma.registration.findUnique({ where: { id: registrationId } });
    if (!reg || reg.pilotId !== id) return res.status(404).json({ error: "not_found" });
    await prisma.registration.delete({ where: { id: registrationId } });
    res.json({ ok: true, id: registrationId });
  }
);

router.post(
  "/",
  authRequired,
  roleAllowed([Role.ORGANIZER]),
  async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid" });
    const data = parsed.data;
    const exists = await prisma.user.findUnique({ where: { email: data.email } });
    if (exists) return res.status(409).json({ error: "email_exists" });
    const tempPwd = data.password ?? Math.random().toString(36).slice(2, 10);
    const hash = await bcrypt.hash(tempPwd, 10);
    const user = await prisma.user.create({
      data: {
        email: data.email,
        password: hash,
        role: Role.PILOT,
      },
    });
    const name = `${data.firstName} ${data.lastName}`.trim();
    const pilot = await prisma.pilotProfile.create({
      data: {
        userId: user.id,
        name,
        number: data.number,
        firstName: data.firstName,
        lastName: data.lastName,
        country: data.country,
        city: data.city,
        age: data.age,
        phone: data.phone,
        emergencyPhone: data.emergencyPhone,
        license: data.license,
      },
    });
    if (data.categoryIds?.length) {
      await prisma.registration.createMany({
        data: data.categoryIds.map((categoryId) => ({
          pilotId: pilot.id,
          categoryId,
          status: RegistrationStatus.APPROVED,
        })),
      });
    }
    res.status(201).json({ pilot, tempPassword: data.password ? undefined : tempPwd });
  }
);

router.post("/public/onboarding", async (req, res) => {
  const parsed = publicOnboardingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid" });
  const data = parsed.data;

  const exists = await prisma.user.findUnique({ where: { email: data.email } });
  if (exists) return res.status(409).json({ error: "email_exists" });

  const categoryIds = Array.from(new Set(data.categoryIds ?? []));
  if (categoryIds.length) {
    const validCount = await prisma.category.count({
      where: { id: { in: categoryIds }, championshipId: data.championshipId },
    });
    if (validCount !== categoryIds.length) return res.status(400).json({ error: "invalid_categories" });
  }

  const tempPwd = data.password ?? Math.random().toString(36).slice(2, 10);
  const hash = await bcrypt.hash(tempPwd, 10);
  const user = await prisma.user.create({
    data: {
      email: data.email,
      password: hash,
      role: Role.PILOT,
    },
  });

  const name = `${data.firstName} ${data.lastName}`.trim();
  const pilot = await prisma.pilotProfile.create({
    data: {
      userId: user.id,
      name,
      number: data.number,
      firstName: data.firstName,
      lastName: data.lastName,
      country: data.country,
      city: data.city,
      age: data.age,
      phone: data.phone,
      emergencyPhone: data.emergencyPhone,
      license: data.license,
    },
  });

  if (categoryIds.length) {
    await prisma.registration.createMany({
      data: categoryIds.map((categoryId) => ({
        pilotId: pilot.id,
        categoryId,
        status: RegistrationStatus.PENDING,
      })),
    });
  }

  res.status(201).json({ pilot: { id: pilot.id, name: pilot.name, number: pilot.number }, tempPassword: data.password ? undefined : tempPwd });
});

export default router;
