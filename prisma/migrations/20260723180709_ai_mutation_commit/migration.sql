-- CreateTable
CREATE TABLE "AiMutationCommit" (
    "jti" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMutationCommit_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE INDEX "AiMutationCommit_userId_idx" ON "AiMutationCommit"("userId");
