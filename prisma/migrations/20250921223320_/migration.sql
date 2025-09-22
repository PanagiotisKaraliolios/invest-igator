-- AlterTable
ALTER TABLE "public"."Transaction" ADD COLUMN     "feeCurrency" "public"."Currency",
ADD COLUMN     "priceCurrency" "public"."Currency" NOT NULL DEFAULT 'USD';

-- CreateTable
CREATE TABLE "public"."FxRate" (
    "id" TEXT NOT NULL,
    "base" "public"."Currency" NOT NULL,
    "quote" "public"."Currency" NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FxRate_fetchedAt_idx" ON "public"."FxRate"("fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FxRate_base_quote_key" ON "public"."FxRate"("base", "quote");
