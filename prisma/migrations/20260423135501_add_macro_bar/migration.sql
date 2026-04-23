-- CreateTable
CREATE TABLE "MacroBar" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION,

    CONSTRAINT "MacroBar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MacroBar_ticker_date_idx" ON "MacroBar"("ticker", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MacroBar_ticker_date_key" ON "MacroBar"("ticker", "date");
