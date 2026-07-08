-- Convert Currency enum columns to text, then drop the enum type.
ALTER TABLE "Transaction" ALTER COLUMN "priceCurrency" DROP DEFAULT;
ALTER TABLE "Transaction" ALTER COLUMN "priceCurrency" SET DATA TYPE TEXT USING "priceCurrency"::text;
ALTER TABLE "Transaction" ALTER COLUMN "priceCurrency" SET DEFAULT 'USD';
ALTER TABLE "Transaction" ALTER COLUMN "feeCurrency" SET DATA TYPE TEXT USING "feeCurrency"::text;

ALTER TABLE "User" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "currency" SET DATA TYPE TEXT USING "currency"::text;
ALTER TABLE "User" ALTER COLUMN "currency" SET DEFAULT 'USD';

ALTER TABLE "WatchlistItem" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "WatchlistItem" ALTER COLUMN "currency" SET DATA TYPE TEXT USING "currency"::text;
ALTER TABLE "WatchlistItem" ALTER COLUMN "currency" SET DEFAULT 'USD';

ALTER TABLE "FxRate" ALTER COLUMN "base" SET DATA TYPE TEXT USING "base"::text;
ALTER TABLE "FxRate" ALTER COLUMN "quote" SET DATA TYPE TEXT USING "quote"::text;

ALTER TABLE "Goal" ALTER COLUMN "targetCurrency" DROP DEFAULT;
ALTER TABLE "Goal" ALTER COLUMN "targetCurrency" SET DATA TYPE TEXT USING "targetCurrency"::text;
ALTER TABLE "Goal" ALTER COLUMN "targetCurrency" SET DEFAULT 'USD';

DROP TYPE "Currency";
