-- CreateEnum
CREATE TYPE "Strategy" AS ENUM ('OSNOVNI', 'KONTRA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MarketType" ADD VALUE 'UNDER_1_5';
ALTER TYPE "MarketType" ADD VALUE 'OVER_3_5';

-- AlterTable
ALTER TABLE "FilterSet" ADD COLUMN     "strategy" "Strategy" NOT NULL DEFAULT 'OSNOVNI';

-- AlterTable
ALTER TABLE "MarketSelection" ADD COLUMN     "triggerOdds" DECIMAL(8,4);

-- AlterTable
ALTER TABLE "RobotScan" ADD COLUMN     "strategy" "Strategy" NOT NULL DEFAULT 'OSNOVNI';

-- CreateIndex
CREATE INDEX "RobotScan_strategy_startedAt_idx" ON "RobotScan"("strategy", "startedAt");
