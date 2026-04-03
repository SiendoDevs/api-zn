DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SinglePointsPolicy') THEN
    CREATE TYPE "SinglePointsPolicy" AS ENUM ('SUM_ALL', 'FIRST_SESSION_PER_EVENT');
  END IF;
END $$;

ALTER TABLE "Category"
  ADD COLUMN IF NOT EXISTS "singlePointsPolicy" "SinglePointsPolicy" NOT NULL DEFAULT 'SUM_ALL';

