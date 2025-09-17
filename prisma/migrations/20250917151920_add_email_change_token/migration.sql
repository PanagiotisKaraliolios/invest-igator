-- CreateTable
CREATE TABLE "public"."EmailChangeToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "newEmail" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailChangeToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailChangeToken_token_key" ON "public"."EmailChangeToken"("token");

-- CreateIndex
CREATE INDEX "EmailChangeToken_userId_idx" ON "public"."EmailChangeToken"("userId");

-- CreateIndex
CREATE INDEX "EmailChangeToken_expiresAt_idx" ON "public"."EmailChangeToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "public"."EmailChangeToken" ADD CONSTRAINT "EmailChangeToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
