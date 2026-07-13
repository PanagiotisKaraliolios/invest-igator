-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('AZURE', 'OPENAI', 'ANTHROPIC', 'GOOGLE', 'OPENAI_COMPATIBLE');

-- CreateEnum
CREATE TYPE "AiSurface" AS ENUM ('CHAT', 'MCP', 'CRON', 'EVAL');

-- CreateEnum
CREATE TYPE "AiCallKind" AS ENUM ('LANGUAGE_MODEL', 'EMBEDDING');

-- CreateEnum
CREATE TYPE "AiBilledTo" AS ENUM ('PLATFORM', 'USER');

-- CreateEnum
CREATE TYPE "AiPricingStatus" AS ENUM ('PRICED', 'UNKNOWN_MODEL');

-- CreateEnum
CREATE TYPE "AiCallOutcome" AS ENUM ('OK', 'ERROR', 'ABORTED', 'CONTENT_FILTERED');

-- AlterTable
ALTER TABLE "apiKey" ADD COLUMN     "keyHmac" TEXT;

-- CreateTable
CREATE TABLE "AiProviderCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "kid" TEXT NOT NULL,
    "iv" BYTEA NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "resourceName" TEXT,
    "baseURL" TEXT,
    "apiVersion" TEXT,
    "deployment" TEXT,
    "defaultModelId" TEXT NOT NULL,
    "label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCall" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "surface" "AiSurface" NOT NULL,
    "functionId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "chatId" TEXT,
    "kind" "AiCallKind" NOT NULL DEFAULT 'LANGUAGE_MODEL',
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "resolvedModel" TEXT NOT NULL,
    "callId" TEXT,
    "responseId" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "noCacheTokens" INTEGER,
    "cacheReadTokens" INTEGER,
    "cacheWriteTokens" INTEGER,
    "textTokens" INTEGER,
    "reasoningTokens" INTEGER,
    "billedTo" "AiBilledTo" NOT NULL,
    "pricingStatus" "AiPricingStatus" NOT NULL DEFAULT 'PRICED',
    "costNanoUsd" BIGINT,
    "priceSnapshotId" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "finishReason" TEXT,
    "outcome" "AiCallOutcome" NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "systemPromptId" TEXT,
    "systemPromptVersion" INTEGER,
    "systemPromptHash" TEXT,

    CONSTRAINT "AiCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiToolCall" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT NOT NULL,
    "userId" TEXT,
    "surface" "AiSurface" NOT NULL,
    "toolName" TEXT NOT NULL,
    "toolCallId" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "durationMs" INTEGER,
    "inputHash" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "AiToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiQuota" (
    "userId" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "limitNanoUsd" BIGINT NOT NULL,
    "spentNanoUsd" BIGINT NOT NULL DEFAULT 0,
    "reservedNanoUsd" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiQuota_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AiQuotaReservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "ceilingNanoUsd" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "AiQuotaReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiChat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "parts" JSONB NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiProviderCredential_userId_idx" ON "AiProviderCredential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AiProviderCredential_userId_provider_key" ON "AiProviderCredential"("userId", "provider");

-- CreateIndex
CREATE INDEX "AiCall_userId_createdAt_idx" ON "AiCall"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiCall_requestId_idx" ON "AiCall"("requestId");

-- CreateIndex
CREATE INDEX "AiCall_createdAt_idx" ON "AiCall"("createdAt");

-- CreateIndex
CREATE INDEX "AiCall_billedTo_createdAt_idx" ON "AiCall"("billedTo", "createdAt");

-- CreateIndex
CREATE INDEX "AiToolCall_requestId_idx" ON "AiToolCall"("requestId");

-- CreateIndex
CREATE INDEX "AiToolCall_userId_createdAt_idx" ON "AiToolCall"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiToolCall_toolName_createdAt_idx" ON "AiToolCall"("toolName", "createdAt");

-- CreateIndex
CREATE INDEX "AiQuotaReservation_userId_settledAt_idx" ON "AiQuotaReservation"("userId", "settledAt");

-- CreateIndex
CREATE INDEX "AiQuotaReservation_requestId_idx" ON "AiQuotaReservation"("requestId");

-- CreateIndex
CREATE INDEX "AiQuotaReservation_createdAt_idx" ON "AiQuotaReservation"("createdAt");

-- CreateIndex
CREATE INDEX "AiChat_userId_updatedAt_idx" ON "AiChat"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "AiMessage_chatId_createdAt_idx" ON "AiMessage"("chatId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "apiKey_keyHmac_key" ON "apiKey"("keyHmac");

-- AddForeignKey
ALTER TABLE "AiProviderCredential" ADD CONSTRAINT "AiProviderCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiQuota" ADD CONSTRAINT "AiQuota_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiChat" ADD CONSTRAINT "AiChat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "AiChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

