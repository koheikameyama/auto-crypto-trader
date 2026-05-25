-- CreateTable
CREATE TABLE "DepositEvent" (
    "id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amountJpy" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepositEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DepositEvent_asset_date_idx" ON "DepositEvent"("asset", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DepositEvent_asset_date_key" ON "DepositEvent"("asset", "date");
