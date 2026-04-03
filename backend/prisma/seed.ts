import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client.js";
import bcrypt from "bcryptjs";
import { Role, SessionType, RegistrationStatus } from "../generated/prisma/enums.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const adminEmail = "organizador@kartzn.test";
  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existing) {
    const password = await bcrypt.hash("organizador123", 10);
    await prisma.user.create({
      data: { email: adminEmail, password, role: Role.ORGANIZER },
    });
  }
  const champName = "Kart ZN 2026";
  const season = 2026;
  let champ = await prisma.championship.findFirst({ where: { name: champName, season } });
  if (!champ) {
    champ = await prisma.championship.create({ data: { name: champName, season } });
  }
  const eventExists = await prisma.event.findFirst({ where: { name: "Fecha 1", championshipId: champ.id } });
  const event = eventExists ?? await prisma.event.create({ data: { name: "Fecha 1", date: new Date(), championshipId: champ.id } });

  // Create a pilot user with profile
  const pilotEmail = "piloto@kartzn.test";
  let pilotUser = await prisma.user.findUnique({ where: { email: pilotEmail } });
  if (!pilotUser) {
    pilotUser = await prisma.user.create({
      data: {
        email: pilotEmail,
        password: await bcrypt.hash("piloto123", 10),
        role: Role.PILOT,
        pilot: { create: { name: "Piloto Demo", number: 77 } },
      },
    });
  }
  const pilotProfile = await prisma.pilotProfile.findUnique({ where: { userId: pilotUser.id } });

  // Category and registration (a nivel campeonato)
  let cat = await prisma.category.findFirst({ where: { championshipId: champ.id, name: "Senior" } });
  if (!cat) {
    cat = await prisma.category.create({ data: { championshipId: champ.id, name: "Senior" } });
  }
  if (pilotProfile) {
    let reg = await prisma.registration.findFirst({ where: { pilotId: pilotProfile.id, categoryId: cat.id } });
    if (!reg) {
      reg = await prisma.registration.create({ data: { pilotId: pilotProfile.id, categoryId: cat.id, status: RegistrationStatus.APPROVED } });
    } else if (reg.status !== RegistrationStatus.APPROVED) {
      await prisma.registration.update({ where: { id: reg.id }, data: { status: RegistrationStatus.APPROVED } });
    }
  }

  // Session and a published result
  let session = await prisma.session.findFirst({ where: { eventId: event.id, name: "Final" } });
  if (!session) {
    session = await prisma.session.create({ data: { eventId: event.id, name: "Final", order: 3, type: SessionType.FINAL, published: true } });
  } else if (!session.published) {
    await prisma.session.update({ where: { id: session.id }, data: { published: true } });
  }
  if (pilotProfile) {
    await prisma.sessionResult.upsert({
      where: { sessionId_pilotId: { sessionId: session.id, pilotId: pilotProfile.id } },
      update: { position: 1, lapTimeMs: 54000, penaltyMs: 0 },
      create: { sessionId: session.id, pilotId: pilotProfile.id, position: 1, lapTimeMs: 54000, penaltyMs: 0 },
    });
  }
}

main().finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
