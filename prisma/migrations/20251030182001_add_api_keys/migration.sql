-- CreateTable
CREATE TABLE "apiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "start" TEXT,
    "prefix" TEXT,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refillInterval" INTEGER,
    "refillAmount" INTEGER,
    "lastRefillAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "remaining" INTEGER,
    "rateLimitEnabled" BOOLEAN NOT NULL DEFAULT false,
    "rateLimitTimeWindow" INTEGER,
    "rateLimitMax" INTEGER,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "lastRequest" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "permissions" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "apiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "apiKey_key_key" ON "apiKey"("key");

-- CreateIndex
CREATE INDEX "apiKey_userId_idx" ON "apiKey"("userId");

-- CreateIndex
CREATE INDEX "apiKey_expiresAt_idx" ON "apiKey"("expiresAt");

-- CreateIndex
CREATE INDEX "apiKey_enabled_idx" ON "apiKey"("enabled");

-- AddForeignKey
ALTER TABLE "apiKey" ADD CONSTRAINT "apiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
