-- CreateEnum
CREATE TYPE "public"."Currency" AS ENUM ('EUR', 'USD', 'GBP', 'HKD', 'CHF', 'RUB');

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "currency" "public"."Currency" NOT NULL DEFAULT 'USD';
