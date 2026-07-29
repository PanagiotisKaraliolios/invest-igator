-- AlterTable: add the enabled-model set, defaulting to empty so existing rows can be added to.
ALTER TABLE "AiProviderCredential" ADD COLUMN "enabledModelIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: every pre-existing credential serves exactly the model it was created with.
UPDATE "AiProviderCredential"
SET "enabledModelIds" = ARRAY["defaultModelId"]
WHERE "enabledModelIds" IS NULL OR cardinality("enabledModelIds") = 0;

-- Now that no row is null, enforce NOT NULL (Prisma's String[] is non-nullable).
ALTER TABLE "AiProviderCredential" ALTER COLUMN "enabledModelIds" SET NOT NULL;
