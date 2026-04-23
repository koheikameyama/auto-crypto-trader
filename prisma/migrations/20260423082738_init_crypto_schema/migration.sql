-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "yfinanceTicker" TEXT NOT NULL,
    "feeRate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyBar" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION,

    CONSTRAINT "DailyBar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacktestRun" (
    "id" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "assetSymbol" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "initialCapital" DOUBLE PRECISION NOT NULL,
    "params" JSONB NOT NULL,
    "totalReturn" DOUBLE PRECISION NOT NULL,
    "sharpe" DOUBLE PRECISION NOT NULL,
    "mar" DOUBLE PRECISION NOT NULL,
    "profitFactor" DOUBLE PRECISION NOT NULL,
    "maxDrawdown" DOUBLE PRECISION NOT NULL,
    "winRate" DOUBLE PRECISION NOT NULL,
    "tradeCount" INTEGER NOT NULL,
    "expectancy" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportPath" TEXT,

    CONSTRAINT "BacktestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalkForwardRun" (
    "id" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isDays" INTEGER NOT NULL,
    "oosDays" INTEGER NOT NULL,
    "stepDays" INTEGER NOT NULL,
    "oosAvgSharpe" DOUBLE PRECISION NOT NULL,
    "oosAvgMar" DOUBLE PRECISION NOT NULL,
    "oosAvgPf" DOUBLE PRECISION NOT NULL,
    "oosMaxDd" DOUBLE PRECISION NOT NULL,
    "isOosSharpeDrop" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "windows" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportPath" TEXT,

    CONSTRAINT "WalkForwardRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "backtestRunId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "exitDate" TIMESTAMP(3),
    "exitPrice" DOUBLE PRECISION,
    "exitReason" TEXT,
    "sizeUnits" DOUBLE PRECISION NOT NULL,
    "pnlUsd" DOUBLE PRECISION,
    "holdingDays" INTEGER,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Asset_symbol_key" ON "Asset"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_yfinanceTicker_key" ON "Asset"("yfinanceTicker");

-- CreateIndex
CREATE INDEX "DailyBar_assetId_date_idx" ON "DailyBar"("assetId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyBar_assetId_date_key" ON "DailyBar"("assetId", "date");

-- CreateIndex
CREATE INDEX "BacktestRun_strategy_assetSymbol_createdAt_idx" ON "BacktestRun"("strategy", "assetSymbol", "createdAt");

-- CreateIndex
CREATE INDEX "WalkForwardRun_strategy_assetSymbol_createdAt_idx" ON "WalkForwardRun"("strategy", "assetSymbol", "createdAt");

-- CreateIndex
CREATE INDEX "Trade_backtestRunId_idx" ON "Trade"("backtestRunId");

-- CreateIndex
CREATE INDEX "Trade_assetId_entryDate_idx" ON "Trade"("assetId", "entryDate");

-- AddForeignKey
ALTER TABLE "DailyBar" ADD CONSTRAINT "DailyBar_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_backtestRunId_fkey" FOREIGN KEY ("backtestRunId") REFERENCES "BacktestRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
