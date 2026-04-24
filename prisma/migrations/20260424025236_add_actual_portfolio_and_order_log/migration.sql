-- CreateTable
CREATE TABLE "ActualPortfolioState" (
    "id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "targetPosition" DOUBLE PRECISION NOT NULL,
    "actualPosition" DOUBLE PRECISION NOT NULL,
    "cashJpy" DOUBLE PRECISION NOT NULL,
    "units" DOUBLE PRECISION NOT NULL,
    "equityJpy" DOUBLE PRECISION NOT NULL,
    "rebalancedToday" BOOLEAN NOT NULL,
    "rebalanceDelta" DOUBLE PRECISION NOT NULL,
    "feeJpy" DOUBLE PRECISION NOT NULL,
    "slippageBps" DOUBLE PRECISION NOT NULL,
    "cumulativeReturn" DOUBLE PRECISION NOT NULL,
    "cumulativeFeeJpy" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActualPortfolioState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLog" (
    "id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "side" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "requestedUnits" DOUBLE PRECISION NOT NULL,
    "execUnits" DOUBLE PRECISION,
    "requestedPrice" DOUBLE PRECISION,
    "execPrice" DOUBLE PRECISION,
    "feeJpy" DOUBLE PRECISION,
    "orderId" TEXT,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "filledAt" TIMESTAMP(3),
    "rawResponse" JSONB,

    CONSTRAINT "OrderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActualPortfolioState_asset_date_idx" ON "ActualPortfolioState"("asset", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ActualPortfolioState_asset_date_key" ON "ActualPortfolioState"("asset", "date");

-- CreateIndex
CREATE INDEX "OrderLog_asset_date_idx" ON "OrderLog"("asset", "date");

-- CreateIndex
CREATE INDEX "OrderLog_status_submittedAt_idx" ON "OrderLog"("status", "submittedAt");
