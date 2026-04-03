import express from "express";
import cors from "cors";
import "dotenv/config";
import { prisma } from "./db.js";
import authRoutes from "./routes/auth.js";
import championshipsRoutes from "./routes/championships.js";
import eventsRoutes from "./routes/events.js";
import categoriesRoutes from "./routes/categories.js";
import registrationsRoutes from "./routes/registrations.js";
import sessionsRoutes from "./routes/sessions.js";
import resultsRoutes from "./routes/results.js";
import pilotsRoutes from "./routes/pilots.js";
import teamsRoutes from "./routes/teams.js";
import { PORT } from "./config.js";
import path from "path";
import bcrypt from "bcryptjs";
import { Role } from "../generated/prisma/enums.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "kart-zn-api" });
});

app.get("/public/championships", async (_req, res) => {
  try {
    const data = await prisma.championship.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    res.json(data);
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/public/championships/:id/teams", async (req, res) => {
  const championshipId = req.params.id as string;
  if (!championshipId) return res.status(400).json({ error: "invalid" });
  try {
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
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/public/events/by-championship/:id", async (req, res) => {
  const id = req.params.id as string;
  try {
    const events = await prisma.event.findMany({
      where: { championshipId: id },
      orderBy: { date: "asc" },
      select: { id: true, name: true, date: true, location: true, trackType: true, circuitVariant: true, status: true },
    });
    res.json(events);
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/public/categories/championships/:championshipId/categories", async (req, res) => {
  const championshipId = req.params.championshipId as string;
  try {
    const categories = await prisma.category.findMany({
      where: { championshipId },
      orderBy: { name: "asc" },
      include: { subcategories: { orderBy: { name: "asc" } } },
    });
    res.json(categories);
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/public/sessions/events/:eventId/sessions", async (req, res) => {
  const eventId = req.params.eventId as string;
  try {
    const sessions = await prisma.session.findMany({
      where: { eventId },
      orderBy: { order: "asc" },
      include: {
        category: { select: { id: true, name: true } },
        subcategory: { select: { id: true, name: true, categoryId: true } },
      },
    });
    res.json(sessions);
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

app.use("/auth", authRoutes);
app.use("/championships", championshipsRoutes);
app.use("/events", eventsRoutes);
app.use("/categories", categoriesRoutes);
app.use("/registrations", registrationsRoutes);
app.use("/sessions", sessionsRoutes);
app.use("/results", resultsRoutes);
app.use("/pilots", pilotsRoutes);
app.use("/teams", teamsRoutes);

async function ensureDevOrganizer() {
  const shouldSeed = process.env.NODE_ENV !== "production" && process.env.JWT_SECRET === "dev_secret_change_me";
  if (!shouldSeed) return;

  const email = "organizador@kartzn.test";
  const password = "organizador123";
  const hash = await bcrypt.hash(password, 10);
  await prisma.user.upsert({
    where: { email },
    update: { password: hash, role: Role.ORGANIZER },
    create: { email, password: hash, role: Role.ORGANIZER },
  });
}

async function start() {
  try {
    await ensureDevOrganizer();
  } catch (e) {
    console.error(e);
  }
  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
  });
}

void start();
