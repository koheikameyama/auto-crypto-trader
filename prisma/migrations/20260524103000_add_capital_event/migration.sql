-- CreateTable
CREATE TABLE "CapitalEvent" (
    "id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "deltaJpy" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapitalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CapitalEvent_asset_date_idx" ON "CapitalEvent"("asset", "date");
