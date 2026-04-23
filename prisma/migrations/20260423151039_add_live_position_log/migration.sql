-- CreateTable
CREATE TABLE "LivePositionLog" (
    "id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "dxyValue" DOUBLE PRECISION NOT NULL,
    "dxyScore" DOUBLE PRECISION NOT NULL,
    "fundingValue" DOUBLE PRECISION NOT NULL,
    "fundingScore" DOUBLE PRECISION NOT NULL,
    "targetPosition" DOUBLE PRECISION NOT NULL,
    "previousPosition" DOUBLE PRECISION,
    "rebalanceFlag" BOOLEAN NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LivePositionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LivePositionLog_asset_date_idx" ON "LivePositionLog"("asset", "date");

-- CreateIndex
CREATE UNIQUE INDEX "LivePositionLog_asset_date_key" ON "LivePositionLog"("asset", "date");
