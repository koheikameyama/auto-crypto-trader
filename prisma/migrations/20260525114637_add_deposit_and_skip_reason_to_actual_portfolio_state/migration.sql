-- AlterTable
ALTER TABLE "ActualPortfolioState" ADD COLUMN     "depositJpy" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "skipReason" TEXT;
