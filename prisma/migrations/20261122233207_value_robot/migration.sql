-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MarketType" ADD VALUE 'OVER_2_5';
ALTER TYPE "MarketType" ADD VALUE 'UNDER_2_5';
ALTER TYPE "MarketType" ADD VALUE 'DC_1X';
ALTER TYPE "MarketType" ADD VALUE 'DC_X2';
ALTER TYPE "MarketType" ADD VALUE 'DC_12';

-- AlterEnum
ALTER TYPE "Strategy" ADD VALUE 'VALUE';

-- AlterTable
ALTER TABLE "MarketSelection" ADD COLUMN     "fairOdds" DECIMAL(8,4),
ADD COLUMN     "refOdds" DECIMAL(8,4),
ADD COLUMN     "valuePct" DECIMAL(6,2);

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "valueMaxOdds" DECIMAL(5,2) NOT NULL DEFAULT 5.00,
ADD COLUMN     "valueMinOdds" DECIMAL(5,2) NOT NULL DEFAULT 1.50,
ADD COLUMN     "valueMinPct" DECIMAL(5,2) NOT NULL DEFAULT 4;

-- Novi početak (Football Value Betting): brišu se svi stari podaci skenera, filtera i rezultata.
-- Nalozi (User, Session) i Podešavanja ostaju.
TRUNCATE TABLE "FilterSetSelection", "FilterSet", "TrackedSelection", "ResultUpdate", "ComboCandidate",
  "MarketSelection", "RobotScan", "Match", "AuditLog", "JobState" CASCADE;
