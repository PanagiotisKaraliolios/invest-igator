-- CreateTable
CREATE TABLE "auditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminEmail" TEXT NOT NULL,
    "targetId" TEXT,
    "targetEmail" TEXT,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auditLog_adminId_idx" ON "auditLog"("adminId");

-- CreateIndex
CREATE INDEX "auditLog_targetId_idx" ON "auditLog"("targetId");

-- CreateIndex
CREATE INDEX "auditLog_action_idx" ON "auditLog"("action");

-- CreateIndex
CREATE INDEX "auditLog_createdAt_idx" ON "auditLog"("createdAt");
