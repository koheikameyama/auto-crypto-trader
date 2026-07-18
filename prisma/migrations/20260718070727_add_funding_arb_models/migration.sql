-- CreateTable
CREATE TABLE "FundingRateDetail" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "markPrice" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingRateDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpotPrice" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "volume24h" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpotPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerpPrice" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "markPrice" DOUBLE PRECISION,
    "volume24h" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerpPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingArbPortfolio" (
    "id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "spotPositionUnits" DOUBLE PRECISION NOT NULL,
    "perpPositionUnits" DOUBLE PRECISION NOT NULL,
    "spotValueJpy" DOUBLE PRECISION NOT NULL,
    "perpValueJpy" DOUBLE PRECISION NOT NULL,
    "netDeltaJpy" DOUBLE PRECISION NOT NULL,
    "fundingEarnedJpy" DOUBLE PRECISION NOT NULL,
    "realizedPnlJpy" DOUBLE PRECISION NOT NULL,
    "unrealizedPnlJpy" DOUBLE PRECISION NOT NULL,
    "totalEquityJpy" DOUBLE PRECISION NOT NULL,
    "marginRatioPercent" DOUBLE PRECISION,
    "liquidationPrice" DOUBLE PRECISION,
    "rebalancedToday" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingArbPortfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArbOpportunity" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "fundingRate" DOUBLE PRECISION NOT NULL,
    "spotPrice" DOUBLE PRECISION NOT NULL,
    "perpPrice" DOUBLE PRECISION NOT NULL,
    "spreadPercent" DOUBLE PRECISION NOT NULL,
    "annualizedReturn" DOUBLE PRECISION NOT NULL,
    "thresholdMet" BOOLEAN NOT NULL,
    "actionTaken" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArbOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FundingRateDetail_symbol_timestamp_idx" ON "FundingRateDetail"("symbol", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "FundingRateDetail_symbol_timestamp_key" ON "FundingRateDetail"("symbol", "timestamp");

-- CreateIndex
CREATE INDEX "SpotPrice_symbol_timestamp_idx" ON "SpotPrice"("symbol", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "SpotPrice_symbol_timestamp_key" ON "SpotPrice"("symbol", "timestamp");

-- CreateIndex
CREATE INDEX "PerpPrice_symbol_timestamp_idx" ON "PerpPrice"("symbol", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "PerpPrice_symbol_timestamp_key" ON "PerpPrice"("symbol", "timestamp");

-- CreateIndex
CREATE INDEX "FundingArbPortfolio_asset_date_idx" ON "FundingArbPortfolio"("asset", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FundingArbPortfolio_asset_date_key" ON "FundingArbPortfolio"("asset", "date");

-- CreateIndex
CREATE INDEX "ArbOpportunity_symbol_timestamp_idx" ON "ArbOpportunity"("symbol", "timestamp");

-- CreateIndex
CREATE INDEX "ArbOpportunity_thresholdMet_timestamp_idx" ON "ArbOpportunity"("thresholdMet", "timestamp");
