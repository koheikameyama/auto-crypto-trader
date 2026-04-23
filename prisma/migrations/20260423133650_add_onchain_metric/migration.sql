-- CreateTable
CREATE TABLE "OnchainMetric" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "priceUsd" DOUBLE PRECISION NOT NULL,
    "capMrktUsd" DOUBLE PRECISION NOT NULL,
    "txCnt" INTEGER NOT NULL,
    "adrActCnt" INTEGER NOT NULL,

    CONSTRAINT "OnchainMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnchainMetric_assetId_date_idx" ON "OnchainMetric"("assetId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "OnchainMetric_assetId_date_key" ON "OnchainMetric"("assetId", "date");

-- AddForeignKey
ALTER TABLE "OnchainMetric" ADD CONSTRAINT "OnchainMetric_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
