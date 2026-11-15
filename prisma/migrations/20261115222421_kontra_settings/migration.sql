-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "kontraFavoriteMax" DECIMAL(4,2) NOT NULL DEFAULT 1.30,
ADD COLUMN     "kontraTriggerMax" DECIMAL(4,2) NOT NULL DEFAULT 1.30;
