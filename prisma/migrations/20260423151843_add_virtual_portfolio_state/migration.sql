-- CreateTable
CREATE TABLE "VirtualPortfolioState" (
    "id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "targetPosition" DOUBLE PRECISION NOT NULL,
    "actualPosition" DOUBLE PRECISION NOT NULL,
    "cashUsd" DOUBLE PRECISION NOT NULL,
    "units" DOUBLE PRECISION NOT NULL,
    "equityUsd" DOUBLE PRECISION NOT NULL,
    "rebalancedToday" BOOLEAN NOT NULL,
    "rebalanceDelta" DOUBLE PRECISION NOT NULL,
    "feeUsd" DOUBLE PRECISION NOT NULL,
    "cumulativeReturn" DOUBLE PRECISION NOT NULL,
    "cumulativeFee" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VirtualPortfolioState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VirtualPortfolioState_asset_date_idx" ON "VirtualPortfolioState"("asset", "date");

-- CreateIndex
CREATE UNIQUE INDEX "VirtualPortfolioState_asset_date_key" ON "VirtualPortfolioState"("asset", "date");
