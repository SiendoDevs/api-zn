-- CreateEnum
CREATE TYPE "TrackType" AS ENUM ('KARTODROME', 'AUTODROME');

-- AlterTable
ALTER TABLE "Championship" ADD COLUMN     "coverImagePath" TEXT;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "circuitVariant" TEXT,
ADD COLUMN     "trackType" "TrackType";
