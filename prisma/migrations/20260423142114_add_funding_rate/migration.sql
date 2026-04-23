-- CreateTable
CREATE TABLE "FundingRate" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "avgRate" DOUBLE PRECISION NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "FundingRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FundingRate_symbol_date_idx" ON "FundingRate"("symbol", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FundingRate_symbol_date_key" ON "FundingRate"("symbol", "date");
