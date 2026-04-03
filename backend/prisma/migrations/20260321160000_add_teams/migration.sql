DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Subcategory_categoryId_fkey'
  ) THEN
    ALTER TABLE "Subcategory"
      ADD CONSTRAINT "Subcategory_categoryId_fkey"
      FOREIGN KEY ("categoryId")
      REFERENCES "Category"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE "Team" (
  "id" TEXT NOT NULL,
  "championshipId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "subcategoryId" TEXT,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamMember" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "pilotId" TEXT NOT NULL,
  "championshipId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamMember_teamId_pilotId_key" ON "TeamMember"("teamId", "pilotId");
CREATE UNIQUE INDEX "TeamMember_championshipId_categoryId_pilotId_key" ON "TeamMember"("championshipId", "categoryId", "pilotId");

ALTER TABLE "Team"
  ADD CONSTRAINT "Team_championshipId_fkey"
  FOREIGN KEY ("championshipId")
  REFERENCES "Championship"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "Team"
  ADD CONSTRAINT "Team_categoryId_fkey"
  FOREIGN KEY ("categoryId")
  REFERENCES "Category"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "Team"
  ADD CONSTRAINT "Team_subcategoryId_fkey"
  FOREIGN KEY ("subcategoryId")
  REFERENCES "Subcategory"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "TeamMember"
  ADD CONSTRAINT "TeamMember_teamId_fkey"
  FOREIGN KEY ("teamId")
  REFERENCES "Team"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "TeamMember"
  ADD CONSTRAINT "TeamMember_pilotId_fkey"
  FOREIGN KEY ("pilotId")
  REFERENCES "PilotProfile"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
